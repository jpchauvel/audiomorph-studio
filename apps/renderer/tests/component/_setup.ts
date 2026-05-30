import type { Page } from '@playwright/test';

// Installs a minimal window.electronAPI mock in the renderer page.
// - request: delegates to fetch(path) so page.route('**/...') interception keeps working.
// - stream: routes through fetch with text/event-stream parsing; returns a dispose fn.
// - openDirectory/openFile/saveAs/vault: stubbed for tests that don't exercise dialogs.
//
// Pages call window.electronAPI.request/stream directly (no base URL); a relative
// fetch resolves against the page origin (the static `serve` on 3000), so any
// page.route('**/<endpoint>') in the spec intercepts it.
export async function installElectronApiMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type StreamEvent = { streamId: string; event: string; data: unknown };
    type StreamError = { code: string; message: string; hint?: string };

    const api = {
      request: async (args: { method: string; path: string; body?: unknown }) => {
        const init: RequestInit = { method: args.method };
        if (args.body !== undefined) {
          init.body = JSON.stringify(args.body);
          init.headers = { 'content-type': 'application/json' };
        }
        const res = await fetch(args.path, init);
        const text = await res.text();
        let body: unknown = text;
        try {
          body = text.length > 0 ? JSON.parse(text) : null;
        } catch {
          // non-json body
        }
        return { status: res.status, body };
      },
      cancel: async () => {},
      stream: (
        args: { streamId: string; path: string; body?: unknown },
        onEvent: (e: StreamEvent) => void,
        onEnd: () => void,
        onError: (e: StreamError) => void,
      ) => {
        const ctrl = new AbortController();
        (async () => {
          try {
            const init: RequestInit = { method: 'POST', signal: ctrl.signal };
            if (args.body !== undefined) {
              init.body = JSON.stringify(args.body);
              init.headers = { 'content-type': 'application/json' };
            }
            const res = await fetch(args.path, init);
            if (!res.ok || !res.body) {
              onError({ code: 'HTTP_ERROR', message: `status ${res.status}` });
              return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const frames = buf.split('\n\n');
              buf = frames.pop() ?? '';
              for (const frame of frames) {
                let event = 'message';
                let data = '';
                for (const line of frame.split('\n')) {
                  if (line.startsWith('event:')) event = line.slice(6).trim();
                  else if (line.startsWith('data:')) data += line.slice(5).trim();
                }
                if (!data) continue;
                let parsed: unknown = data;
                try {
                  parsed = JSON.parse(data);
                } catch {
                  // raw string
                }
                onEvent({ streamId: args.streamId, event, data: parsed });
              }
            }
            onEnd();
          } catch (err) {
            if ((err as { name?: string }).name === 'AbortError') return;
            onError({ code: 'STREAM_ERROR', message: (err as Error).message });
          }
        })();
        return () => ctrl.abort();
      },
      streamCancel: async () => {},
      saveAs: async () => ({ filePath: undefined, canceled: true }),
      openDirectory: async () => ({ dirPath: '/tmp/models', canceled: false }),
      openFile: async () => ({ filePaths: [], canceled: true }),
      copyFile: async () => ({ ok: true as const }),
      readFile: async () => ({ data: '' }),
      openExternal: async () => ({ ok: true as const }),
      showItemInFolder: async () => ({ ok: true as const }),
      getVersion: async () =>
        (window as unknown as { __AUDIOMORPH_VERSION__?: string }).__AUDIOMORPH_VERSION__ ??
        '0.0.0-test',
      getPath: async () => '/tmp',
      hardwareCheck: async () => ({
        ok: true,
        failures: [],
        details: {
          os: 'darwin',
          arch: 'arm64',
          gpu: null,
          vram_gb: null,
          ram_gb: 16,
          disk_gb: 100,
        },
      }),
      vault: {
        set: async () => ({ ok: true as const }),
        get: async () => ({ present: false }),
        delete: async () => ({ ok: true as const }),
        has: async () => ({ present: false }),
      },
    };

    (window as unknown as { electronAPI: typeof api }).electronAPI = api;
    (window as unknown as { __AUDIOMORPH_TEST_MODE__: boolean }).__AUDIOMORPH_TEST_MODE__ = true;
    (window as unknown as { __AUDIOMORPH_API_BASE__: string }).__AUDIOMORPH_API_BASE__ = '';
    (window as unknown as { __AUDIOMORPH_TOKEN__: string }).__AUDIOMORPH_TOKEN__ = 'test-token';
  });
}
