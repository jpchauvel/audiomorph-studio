import { app, dialog, ipcMain, shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import type {
  ApiCancelInput,
  ApiRequestInput,
  ApiRequestOutput,
  ApiStreamCancelInput,
  ApiStreamInput,
  AppGetPathInput,
  DialogOpenDirectoryInput,
  DialogOpenFileInput,
  DialogSaveAsInput,
  FsCopyFileInput,
  FsReadFileInput,
  IpcInvokeChannel,
  IpcInvokeMap,
  ShellOpenExternalInput,
  ShellShowItemInFolderInput,
} from '@audiomorph/ipc-contracts';
import { SidecarManager } from '../sidecar/manager';

type SidecarLike = Pick<SidecarManager, 'getApiBaseUrl' | 'getApiToken'>;

type LoggerFn = (message: string) => void;

const MAX_READ_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['huggingface.co', 'openrouter.ai', 'github.com']);
const ALLOWED_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.log', '.srt', '.lrc']);
const ALLOWED_AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg']);

const REQUEST_CONTROLLERS = new Map<string, AbortController>();
const STREAM_CONTROLLERS = new Map<string, AbortController>();

export interface RegisterIpcBridgeOptions {
  sidecar?: SidecarLike;
  fetchImpl?: typeof fetch;
  logger?: LoggerFn;
}

class IpcBridgeError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'IpcBridgeError';
    this.code = code;
  }
}

function handleTyped<C extends IpcInvokeChannel>(
  channel: C,
  handler: (
    event: Electron.IpcMainInvokeEvent,
    payload: IpcInvokeMap[C]['in'],
  ) => Promise<IpcInvokeMap[C]['out']> | IpcInvokeMap[C]['out'],
): void {
  if (typeof ipcMain.removeHandler === 'function') {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle(channel, (event, payload) => handler(event, payload as IpcInvokeMap[C]['in']));
}

function resolveAllowedRoots(): string[] {
  const userData = app.getPath('userData');
  const sidecarTmp =
    process.env.AUDIOMORPH_SIDECAR_TMP_DIR ?? path.join(os.tmpdir(), 'audiomorph-studio');
  return [userData, sidecarTmp].map((p) => path.resolve(p));
}

function isWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return (
    resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

function assertAllowedPath(candidatePath: string): void {
  const roots = resolveAllowedRoots();
  const allowed = roots.some((root) => isWithinRoot(candidatePath, root));
  if (!allowed) {
    throw new IpcBridgeError('PATH_NOT_ALLOWED', 'Path is outside allowed roots');
  }
}

function isAllowedReadType(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_TEXT_EXTENSIONS.has(ext) || ALLOWED_AUDIO_EXTENSIONS.has(ext);
}

function joinApiUrl(baseUrl: string, requestPath: string): string {
  const normalized = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  return `${baseUrl}${normalized}`;
}

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  const text = await response.text();
  return parseMaybeJson(text);
}

function toIpcErrorPayload(err: unknown): { code: string; message: string; hint?: string } {
  if (err instanceof IpcBridgeError) {
    return { code: err.code, message: err.message };
  }
  if (err && typeof err === 'object') {
    const maybeErr = err as { code?: unknown; message?: unknown; hint?: unknown };
    if (typeof maybeErr.code === 'string' && typeof maybeErr.message === 'string') {
      return {
        code: maybeErr.code,
        message: maybeErr.message,
        hint: typeof maybeErr.hint === 'string' ? maybeErr.hint : undefined,
      };
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: err instanceof Error ? err.message : 'Unexpected IPC bridge error',
  };
}

async function forwardSse(
  sender: Electron.WebContents,
  input: ApiStreamInput,
  sidecar: SidecarLike,
  fetchImpl: typeof fetch,
): Promise<void> {
  const { streamId, path: streamPath, body } = input;
  const controller = new AbortController();
  STREAM_CONTROLLERS.set(streamId, controller);

  // Priority 1 (Correctness): SSE endpoints in the sidecar are GET (FastAPI
  // `@router.get(".../events")`). If a body is supplied we still POST so
  // future job-creating streaming endpoints keep working; otherwise GET so
  // pure event subscriptions like `/models/jobs/{id}/events` succeed.
  const hasBody = body !== undefined;
  const method = hasBody ? 'POST' : 'GET';
  const headers: Record<string, string> = {
    'X-Audiomorph-Token': sidecar.getApiToken(),
    Accept: 'text/event-stream',
  };
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetchImpl(joinApiUrl(sidecar.getApiBaseUrl(), streamPath), {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const resBody = await readJsonOrText(response);
      if (resBody && typeof resBody === 'object' && 'error' in resBody) {
        sender.send('api:stream:error', {
          streamId,
          error: (resBody as { error: unknown }).error,
        });
      } else {
        sender.send('api:stream:error', {
          streamId,
          error: {
            code: 'STREAM_HTTP_ERROR',
            message: `SSE request failed with status ${response.status}`,
          },
        });
      }
      return;
    }

    if (!response.body) {
      throw new IpcBridgeError('STREAM_NO_BODY', 'SSE response has no body');
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';
    let currentEvent = 'message';
    let currentDataLines: string[] = [];

    const flushEvent = (): void => {
      if (currentDataLines.length === 0) {
        currentEvent = 'message';
        return;
      }
      const raw = currentDataLines.join('\n');
      sender.send('api:stream:event', {
        streamId,
        event: currentEvent,
        data: parseMaybeJson(raw),
      });
      currentEvent = 'message';
      currentDataLines = [];
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        flushEvent();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line === '') {
          flushEvent();
          continue;
        }
        if (line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trim() || 'message';
          continue;
        }
        if (line.startsWith('data:')) {
          currentDataLines.push(line.slice('data:'.length).trimStart());
        }
      }
    }

    sender.send('api:stream:end', { streamId });
  } catch (err) {
    if (controller.signal.aborted) {
      sender.send('api:stream:end', { streamId });
      return;
    }
    sender.send('api:stream:error', {
      streamId,
      error: toIpcErrorPayload(err),
    });
  } finally {
    STREAM_CONTROLLERS.delete(streamId);
  }
}

export function registerIpcBridge(options: RegisterIpcBridgeOptions = {}): void {
  const sidecar = options.sidecar ?? SidecarManager.getInstance();
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? ((line: string) => console.info(line));

  handleTyped(
    'api:request',
    async (_event, payload: ApiRequestInput): Promise<ApiRequestOutput> => {
      const { method, path: requestPath, body, requestId } = payload;
      const controller = new AbortController();

      if (requestId) {
        REQUEST_CONTROLLERS.get(requestId)?.abort();
        REQUEST_CONTROLLERS.set(requestId, controller);
      }

      try {
        const response = await fetchImpl(joinApiUrl(sidecar.getApiBaseUrl(), requestPath), {
          method,
          headers: {
            'X-Audiomorph-Token': sidecar.getApiToken(),
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        const responseBody = await readJsonOrText(response);
        logger(`[ipc] ${method.toUpperCase()} ${requestPath} ${response.status}`);
        return {
          status: response.status,
          body: responseBody,
        };
      } finally {
        if (requestId) {
          REQUEST_CONTROLLERS.delete(requestId);
        }
      }
    },
  );

  handleTyped('api:cancel', async (_event, payload: ApiCancelInput) => {
    REQUEST_CONTROLLERS.get(payload.requestId)?.abort();
    REQUEST_CONTROLLERS.delete(payload.requestId);
    return { ok: true };
  });

  handleTyped('api:stream', async (event, payload: ApiStreamInput) => {
    STREAM_CONTROLLERS.get(payload.streamId)?.abort();
    void forwardSse(event.sender, payload, sidecar, fetchImpl);
    return { ok: true };
  });

  handleTyped('api:stream:cancel', async (_event, payload: ApiStreamCancelInput) => {
    STREAM_CONTROLLERS.get(payload.streamId)?.abort();
    STREAM_CONTROLLERS.delete(payload.streamId);
    return { ok: true };
  });

  handleTyped('dialog:saveAs', async (_event, payload: DialogSaveAsInput) => {
    const result = await dialog.showSaveDialog({
      defaultPath: payload.defaultPath,
      filters: payload.filters,
    });
    return {
      filePath: result.filePath,
      canceled: result.canceled,
    };
  });

  handleTyped('dialog:openDirectory', async (_event, payload: DialogOpenDirectoryInput) => {
    const result = await dialog.showOpenDialog({
      title: payload.title,
      properties: ['openDirectory'],
    });
    return {
      dirPath: result.filePaths[0],
      canceled: result.canceled,
    };
  });

  handleTyped('dialog:openFile', async (_event, payload: DialogOpenFileInput) => {
    const properties: Electron.OpenDialogOptions['properties'] = ['openFile'];
    if (payload.multiSelections) {
      properties.push('multiSelections');
    }
    const result = await dialog.showOpenDialog({
      title: payload.title,
      filters: payload.filters,
      properties,
    });
    return {
      filePaths: result.filePaths,
      canceled: result.canceled,
    };
  });

  handleTyped('fs:copyFile', async (_event, payload: FsCopyFileInput) => {
    assertAllowedPath(payload.src);
    await fs.copyFile(payload.src, payload.dst);
    return { ok: true };
  });

  handleTyped('fs:readFile', async (_event, payload: FsReadFileInput) => {
    const encoding = payload.encoding ?? 'utf8';
    assertAllowedPath(payload.filePath);
    if (!isAllowedReadType(payload.filePath)) {
      throw new IpcBridgeError('PATH_NOT_ALLOWED', 'File type is not allowed');
    }

    const stat = await fs.stat(payload.filePath);
    if (stat.size > MAX_READ_FILE_BYTES) {
      throw new IpcBridgeError('FILE_TOO_LARGE', 'File exceeds 10MB limit');
    }

    const data = await fs.readFile(payload.filePath, encoding);
    return {
      data,
    };
  });

  handleTyped('shell:openExternal', async (_event, payload: ShellOpenExternalInput) => {
    let parsed: URL;
    try {
      parsed = new URL(payload.url);
    } catch {
      throw new IpcBridgeError('URL_NOT_ALLOWED', 'Invalid URL');
    }

    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
      throw new IpcBridgeError('URL_NOT_ALLOWED', 'URL host is not allowlisted');
    }

    await shell.openExternal(payload.url);
    return { ok: true };
  });

  handleTyped('shell:showItemInFolder', async (_event, payload: ShellShowItemInFolderInput) => {
    shell.showItemInFolder(payload.filePath);
    return { ok: true };
  });

  handleTyped('app:getVersion', async () => ({ version: app.getVersion() }));

  handleTyped('app:getPath', async (_event, payload: AppGetPathInput) => {
    if (payload.name !== 'userData' && payload.name !== 'downloads') {
      throw new IpcBridgeError('PATH_NOT_ALLOWED', 'Path key is not allowed');
    }
    return { path: app.getPath(payload.name) };
  });

  // AUDIOMORPH_TEST_MODE hook: expose sidecar port + token to test driver.
  // Gated by env so the channel does not exist in production builds.
  // Used by @audiomorph/test-helpers/electron to introspect sidecar state.
  if (process.env.AUDIOMORPH_TEST_MODE === '1') {
    if (typeof ipcMain.removeHandler === 'function') {
      ipcMain.removeHandler('__audiomorph_test:get-sidecar-info');
    }
    ipcMain.handle('__audiomorph_test:get-sidecar-info', () => {
      const baseUrl = sidecar.getApiBaseUrl();
      const port = Number.parseInt(baseUrl.split(':').pop() ?? '0', 10);
      return {
        port,
        token: sidecar.getApiToken(),
      };
    });
  }
}
