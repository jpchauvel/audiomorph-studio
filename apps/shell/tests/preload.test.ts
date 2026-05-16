import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const exposeInMainWorld = vi.fn();
  const invoke = vi.fn();
  const on = vi.fn();
  const removeListener = vi.fn();

  return {
    exposeInMainWorld,
    invoke,
    on,
    removeListener,
  };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}));

describe('preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function loadApi(): Promise<Record<string, unknown>> {
    await import('../src/preload');
    expect(mocks.exposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.any(Object));
    const [, api] = mocks.exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>];
    return api;
  }

  it('exposes window.electronAPI via contextBridge.exposeInMainWorld', async () => {
    await import('../src/preload');
    expect(mocks.exposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.any(Object));
  });

  it("request() calls ipcRenderer.invoke('api:request', args)", async () => {
    const api = await loadApi();
    const args = { method: 'POST', path: '/jobs', body: { x: 1 }, requestId: 'req-1' };
    mocks.invoke.mockResolvedValueOnce({ status: 200, body: { ok: true } });

    await (api.request as (value: unknown) => Promise<unknown>)(args);

    expect(mocks.invoke).toHaveBeenCalledWith('api:request', args);
  });

  it('stream() registers listeners for event/end/error channels', async () => {
    const api = await loadApi();
    const args = { streamId: 'stream-1', path: '/stream', body: { prompt: 'hi' } };

    (api.stream as (...args: unknown[]) => unknown)(args, vi.fn(), vi.fn(), vi.fn());

    expect(mocks.on).toHaveBeenCalledWith('api:stream:event', expect.any(Function));
    expect(mocks.on).toHaveBeenCalledWith('api:stream:end', expect.any(Function));
    expect(mocks.on).toHaveBeenCalledWith('api:stream:error', expect.any(Function));
  });

  it('stream() cancel removes listeners and invokes api:stream:cancel', async () => {
    const api = await loadApi();
    const args = { streamId: 'stream-2', path: '/stream' };

    const cancel = (api.stream as (...args: unknown[]) => () => void)(
      args,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    cancel();

    expect(mocks.invoke).toHaveBeenCalledWith('api:stream:cancel', { streamId: 'stream-2' });
    expect(mocks.removeListener).toHaveBeenCalledWith('api:stream:event', expect.any(Function));
    expect(mocks.removeListener).toHaveBeenCalledWith('api:stream:end', expect.any(Function));
    expect(mocks.removeListener).toHaveBeenCalledWith('api:stream:error', expect.any(Function));
  });

  it("saveAs() calls ipcRenderer.invoke('dialog:saveAs', args)", async () => {
    const api = await loadApi();
    const args = { defaultPath: '/tmp/out.wav' };

    await (api.saveAs as (value: unknown) => Promise<unknown>)(args);

    expect(mocks.invoke).toHaveBeenCalledWith('dialog:saveAs', args);
  });

  it("openExternal() calls ipcRenderer.invoke('shell:openExternal', args)", async () => {
    const api = await loadApi();
    const args = { url: 'https://github.com' };

    await (api.openExternal as (value: unknown) => Promise<unknown>)(args);

    expect(mocks.invoke).toHaveBeenCalledWith('shell:openExternal', args);
  });

  it("getVersion() calls ipcRenderer.invoke('app:getVersion')", async () => {
    const api = await loadApi();
    mocks.invoke.mockResolvedValueOnce({ version: '9.9.9' });

    await (api.getVersion as () => Promise<string>)();

    expect(mocks.invoke).toHaveBeenCalledWith('app:getVersion');
  });

  it('does not expose ipcRenderer directly on electronAPI', async () => {
    const api = await loadApi();
    expect('ipcRenderer' in api).toBe(false);
  });

  it("hardwareCheck() calls ipcRenderer.invoke('hardware:check')", async () => {
    const api = await loadApi();

    await (api.hardwareCheck as () => Promise<unknown>)();

    expect(mocks.invoke).toHaveBeenCalledWith('hardware:check');
  });
});
