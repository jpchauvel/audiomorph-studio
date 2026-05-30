import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

type IpcHandler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown> | unknown;

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  const app = {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/userData';
      if (name === 'downloads') return '/tmp/downloads';
      return '/tmp/other';
    }),
    getVersion: vi.fn(() => '1.2.3'),
  };
  return {
    handlers,
    app,
    ipcMain: {
      handle: vi.fn((channel: string, cb: IpcHandler) => {
        handlers.set(channel, cb);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
    },
    dialog: {
      showSaveDialog: vi.fn(),
      showOpenDialog: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(() => Promise.resolve()),
      showItemInFolder: vi.fn(),
    },
    fsCopyFile: vi.fn(() => Promise.resolve()),
    fsStat: vi.fn(() => Promise.resolve({ size: 16 })),
    fsReadFile: vi.fn((_filePath: string, _enc: BufferEncoding) => Promise.resolve('contents')),
    fetch: vi.fn(),
    logger: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: mocks.ipcMain,
  dialog: mocks.dialog,
  shell: mocks.shell,
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

vi.mock('node:fs/promises', () => ({
  copyFile: mocks.fsCopyFile,
  stat: mocks.fsStat,
  readFile: mocks.fsReadFile,
}));

function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function createSseResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

describe('IPC bridge', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    process.env.AUDIOMORPH_SIDECAR_TMP_DIR = '/tmp/audiomorph-studio';

    const mod = await import('../../src/ipc/bridge');
    mod.registerIpcBridge({
      sidecar: {
        getApiBaseUrl: () => 'http://127.0.0.1:40123',
        getApiToken: () => 'super-secret-token',
      },
      fetchImpl: mocks.fetch as unknown as typeof fetch,
      logger: mocks.logger,
    });
  });

  it('api:request proxies with X-Audiomorph-Token header and returns status/body', async () => {
    mocks.fetch.mockResolvedValueOnce(createJsonResponse({ ok: true }, { status: 201 }));
    const handler = mocks.handlers.get('api:request');
    expect(handler).toBeDefined();

    const out = (await handler?.(
      { sender: { send: vi.fn() } },
      { method: 'POST', path: '/jobs', body: { a: 1 } },
    )) as {
      status: number;
      body: unknown;
    };

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:40123/jobs');
    expect(init.headers).toMatchObject({
      'X-Audiomorph-Token': 'super-secret-token',
      'Content-Type': 'application/json',
    });
    expect(out).toEqual({ status: 201, body: { ok: true } });
  });

  it('api:cancel aborts in-flight api:request', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocks.fetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve, reject) => {
        capturedSignal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
        setTimeout(() => resolve(createJsonResponse({ ok: true })), 25);
      });
    });

    const reqHandler = mocks.handlers.get('api:request')!;
    const cancelHandler = mocks.handlers.get('api:cancel')!;

    const requestPromise = reqHandler(
      { sender: { send: vi.fn() } },
      { method: 'GET', path: '/healthz', requestId: 'r-1' },
    );
    await Promise.resolve();

    await cancelHandler({ sender: { send: vi.fn() } }, { requestId: 'r-1' });
    await expect(requestPromise).rejects.toThrow();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('api:stream forwards SSE messages to renderer via webContents.send', async () => {
    mocks.fetch.mockResolvedValueOnce(
      createSseResponse([
        'event: progress\n',
        'data: {"step":1}\n\n',
        'event: done\n',
        'data: {"ok":true}\n\n',
      ]),
    );
    const send = vi.fn();

    const streamHandler = mocks.handlers.get('api:stream')!;
    await streamHandler({ sender: { send } }, { streamId: 's1', path: '/jobs/events' });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('api:stream:event', {
        streamId: 's1',
        event: 'done',
        data: { ok: true },
      });
    });

    expect(send).toHaveBeenCalledWith('api:stream:event', {
      streamId: 's1',
      event: 'progress',
      data: { step: 1 },
    });
    expect(send).toHaveBeenCalledWith('api:stream:end', { streamId: 's1' });
  });

  it('api:stream:cancel aborts active stream', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocks.fetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve, reject) => {
        capturedSignal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
        setTimeout(() => {
          resolve(createSseResponse(['event: ping\n', 'data: {}\n\n']));
        }, 100);
      });
    });

    const send = vi.fn();
    const streamHandler = mocks.handlers.get('api:stream')!;
    const cancelHandler = mocks.handlers.get('api:stream:cancel')!;

    await streamHandler({ sender: { send } }, { streamId: 's2', path: '/jobs/events' });
    await cancelHandler({ sender: { send } }, { streamId: 's2' });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('fs:copyFile rejects path traversal outside allowlist', async () => {
    const copyHandler = mocks.handlers.get('fs:copyFile')!;
    await expect(
      copyHandler(
        { sender: { send: vi.fn() } },
        { src: '../../../etc/passwd', dst: '/tmp/userData/out.txt' },
      ),
    ).rejects.toMatchObject({
      code: 'PATH_NOT_ALLOWED',
    });
    expect(mocks.fsCopyFile).not.toHaveBeenCalled();
  });

  it('shell:openExternal enforces allowlist', async () => {
    const handler = mocks.handlers.get('shell:openExternal')!;

    await expect(
      handler({ sender: { send: vi.fn() } }, { url: 'https://evil.example.com/phish' }),
    ).rejects.toMatchObject({
      code: 'URL_NOT_ALLOWED',
    });

    await expect(
      handler({ sender: { send: vi.fn() } }, { url: 'https://huggingface.co/spaces' }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.shell.openExternal).toHaveBeenCalledWith('https://huggingface.co/spaces');
  });

  it('api:request forwards error envelope response verbatim', async () => {
    const envelope = { error: { code: 'SIDECAR_DOWN', message: 'Temporarily unavailable' } };
    mocks.fetch.mockResolvedValueOnce(createJsonResponse(envelope, { status: 503 }));
    const handler = mocks.handlers.get('api:request')!;

    const out = await handler({ sender: { send: vi.fn() } }, { method: 'GET', path: '/models' });

    expect(out).toEqual({ status: 503, body: envelope });
  });

  it('renderer response values never include sidecar token', async () => {
    const token = 'super-secret-token';
    mocks.fetch.mockResolvedValueOnce(createJsonResponse({ ok: true }, { status: 200 }));

    const handler = mocks.handlers.get('api:request')!;
    const out = await handler({ sender: { send: vi.fn() } }, { method: 'GET', path: '/healthz' });

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(token);
  });

  it('api:request injects X-HuggingFace-Token from vault for /models/* paths', async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.fetch.mockResolvedValueOnce(createJsonResponse({ job_id: 'j-1' }, { status: 200 }));
    const vaultGet = vi.fn(async (key: string) =>
      key === 'hf_token' ? 'hf_vault_token_abc' : null,
    );

    const mod = await import('../../src/ipc/bridge');
    mod.registerIpcBridge({
      sidecar: {
        getApiBaseUrl: () => 'http://127.0.0.1:40123',
        getApiToken: () => 'super-secret-token',
      },
      fetchImpl: mocks.fetch as unknown as typeof fetch,
      logger: mocks.logger,
      vaultGet,
    });

    const handler = mocks.handlers.get('api:request')!;
    await handler(
      { sender: { send: vi.fn() } },
      { method: 'POST', path: '/models/HeartMuLa__HeartMuLaGen/download' },
    );

    expect(vaultGet).toHaveBeenCalledWith('hf_token');
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'X-HuggingFace-Token': 'hf_vault_token_abc',
    });
  });

  it('api:request omits X-HuggingFace-Token when vault has no hf_token', async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.fetch.mockResolvedValueOnce(createJsonResponse({ ok: true }, { status: 200 }));
    const vaultGet = vi.fn(async () => null);

    const mod = await import('../../src/ipc/bridge');
    mod.registerIpcBridge({
      sidecar: {
        getApiBaseUrl: () => 'http://127.0.0.1:40123',
        getApiToken: () => 'super-secret-token',
      },
      fetchImpl: mocks.fetch as unknown as typeof fetch,
      logger: mocks.logger,
      vaultGet,
    });

    const handler = mocks.handlers.get('api:request')!;
    await handler(
      { sender: { send: vi.fn() } },
      { method: 'POST', path: '/models/HeartMuLa__HeartMuLaGen/download' },
    );

    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-HuggingFace-Token']).toBeUndefined();
  });

  it('api:request does not inject X-HuggingFace-Token on non-/models paths', async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.fetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));
    const vaultGet = vi.fn(async () => 'hf_should_not_be_used');

    const mod = await import('../../src/ipc/bridge');
    mod.registerIpcBridge({
      sidecar: {
        getApiBaseUrl: () => 'http://127.0.0.1:40123',
        getApiToken: () => 'super-secret-token',
      },
      fetchImpl: mocks.fetch as unknown as typeof fetch,
      logger: mocks.logger,
      vaultGet,
    });

    const handler = mocks.handlers.get('api:request')!;
    await handler(
      { sender: { send: vi.fn() } },
      { method: 'GET', path: '/healthz' },
    );

    expect(vaultGet).not.toHaveBeenCalled();
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-HuggingFace-Token']).toBeUndefined();
  });

  it('api:stream injects X-HuggingFace-Token from vault for /models/* SSE streams', async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.fetch.mockResolvedValueOnce(
      createSseResponse(['event: progress\n', 'data: {"bytes_done":1}\n\n']),
    );
    const vaultGet = vi.fn(async () => 'hf_stream_token_xyz');

    const mod = await import('../../src/ipc/bridge');
    mod.registerIpcBridge({
      sidecar: {
        getApiBaseUrl: () => 'http://127.0.0.1:40123',
        getApiToken: () => 'super-secret-token',
      },
      fetchImpl: mocks.fetch as unknown as typeof fetch,
      logger: mocks.logger,
      vaultGet,
    });

    const send = vi.fn();
    const handler = mocks.handlers.get('api:stream')!;
    await handler(
      { sender: { send } },
      { streamId: 's-hf-1', path: '/models/jobs/abc/events' },
    );
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('api:stream:end', { streamId: 's-hf-1' });
    });

    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'X-HuggingFace-Token': 'hf_stream_token_xyz',
    });
  });

  it('api:fetchAudio proxies sidecar WAV bytes and strips token from response', async () => {
    const wavBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    mocks.fetch.mockResolvedValueOnce(
      new Response(wavBytes, { status: 200, headers: { 'content-type': 'audio/wav' } }),
    );

    const handler = mocks.handlers.get('api:fetchAudio')!;
    const out = (await handler(
      { sender: { send: vi.fn() } },
      { jobId: 'abc-123' },
    )) as { bytes: Uint8Array; contentType: string };

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:40123/jobs/abc-123/audio');
    expect((init.headers as Record<string, string>)['X-Audiomorph-Token']).toBe(
      'super-secret-token',
    );
    expect(out.contentType).toBe('audio/wav');
    expect(Array.from(out.bytes)).toEqual(Array.from(wavBytes));
    expect(JSON.stringify(Array.from(out.bytes))).not.toContain('super-secret-token');
  });

  it('api:fetchAudio rejects invalid jobId', async () => {
    const handler = mocks.handlers.get('api:fetchAudio')!;
    await expect(
      handler({ sender: { send: vi.fn() } }, { jobId: '../../etc/passwd' }),
    ).rejects.toMatchObject({ code: 'INVALID_JOB_ID' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('api:fetchAudio surfaces upstream non-200 as AUDIO_FETCH_FAILED', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    const handler = mocks.handlers.get('api:fetchAudio')!;
    await expect(
      handler({ sender: { send: vi.fn() } }, { jobId: 'missing-job' }),
    ).rejects.toMatchObject({ code: 'AUDIO_FETCH_FAILED' });
  });
});
