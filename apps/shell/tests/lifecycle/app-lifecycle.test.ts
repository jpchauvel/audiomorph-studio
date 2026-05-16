import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;
let mockPlatform: NodeJS.Platform = 'darwin';

vi.mock('node:process', async () => {
  const actual = await vi.importActual<typeof import('node:process')>('node:process');
  return {
    ...actual,
    get platform() {
      return mockPlatform;
    },
  };
});

vi.mock('electron', () => {
  const app = {
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setAsDefaultProtocolClient: vi.fn(),
    isPackaged: false,
    dock: {
      setIcon: vi.fn(),
    },
  };

  const ipcMain = {
    emit: vi.fn(),
  };

  const nativeImage = {
    createFromPath: vi.fn(() => ({ isEmpty: () => false })),
  };

  class BrowserWindow {
    isMinimized = vi.fn(() => false);
    restore = vi.fn();
    focus = vi.fn();
    setIcon = vi.fn();
    on = vi.fn();
  }

  return { app, BrowserWindow, ipcMain, nativeImage };
});

async function loadLifecycleModule() {
  return import('../../src/lifecycle/app-lifecycle');
}

function emitAppEvent(
  onMock: ReturnType<typeof vi.fn>,
  eventName: string,
  ...args: unknown[]
): void {
  const calls = onMock.mock.calls.filter(([event]) => event === eventName);
  for (const [, cb] of calls) {
    (cb as Handler)(...args);
  }
}

beforeEach(async () => {
  vi.resetModules();
  mockPlatform = 'darwin';
  const electron = (await import('electron')) as unknown as {
    app: { requestSingleInstanceLock: ReturnType<typeof vi.fn> };
  };
  electron.app.requestSingleInstanceLock.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setupAppLifecycle', () => {
  it('single-instance lock acquired proceeds normally', async () => {
    mockPlatform = 'darwin';
    const { setupAppLifecycle } = await loadLifecycleModule();
    const electron = (await import('electron')) as unknown as {
      app: {
        requestSingleInstanceLock: ReturnType<typeof vi.fn>;
        quit: ReturnType<typeof vi.fn>;
        setAsDefaultProtocolClient: ReturnType<typeof vi.fn>;
      };
    };

    setupAppLifecycle(() => null);

    expect(electron.app.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(electron.app.quit).not.toHaveBeenCalled();
    expect(electron.app.setAsDefaultProtocolClient).toHaveBeenCalledWith('audiomorph');
  });

  it('single-instance lock failure quits immediately', async () => {
    const { setupAppLifecycle } = await loadLifecycleModule();
    const electron = (await import('electron')) as unknown as {
      app: {
        requestSingleInstanceLock: ReturnType<typeof vi.fn>;
        quit: ReturnType<typeof vi.fn>;
      };
    };
    electron.app.requestSingleInstanceLock.mockReturnValue(false);

    setupAppLifecycle(() => null);

    expect(electron.app.quit).toHaveBeenCalledOnce();
  });

  it('second-instance focuses and restores existing window', async () => {
    mockPlatform = 'win32';
    const { setupAppLifecycle } = await loadLifecycleModule();
    const electron = (await import('electron')) as unknown as {
      app: { on: ReturnType<typeof vi.fn> };
      BrowserWindow: new () => {
        isMinimized: ReturnType<typeof vi.fn>;
        restore: ReturnType<typeof vi.fn>;
        focus: ReturnType<typeof vi.fn>;
      };
    };

    const win = new electron.BrowserWindow();
    win.isMinimized.mockReturnValue(true);
    setupAppLifecycle(() => win);

    emitAppEvent(electron.app.on, 'second-instance', {}, ['app.exe']);

    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it('window-all-closed on non-macOS quits app', async () => {
    mockPlatform = 'linux';
    const { setupAppLifecycle } = await loadLifecycleModule();
    const electron = (await import('electron')) as unknown as {
      app: { on: ReturnType<typeof vi.fn>; quit: ReturnType<typeof vi.fn> };
    };

    setupAppLifecycle(() => null);
    emitAppEvent(electron.app.on, 'window-all-closed');

    expect(electron.app.quit).toHaveBeenCalledOnce();
  });

  it('window-all-closed on macOS does not quit app', async () => {
    mockPlatform = 'darwin';
    const { setupAppLifecycle } = await loadLifecycleModule();
    const electron = (await import('electron')) as unknown as {
      app: { on: ReturnType<typeof vi.fn>; quit: ReturnType<typeof vi.fn> };
    };

    setupAppLifecycle(() => null);
    emitAppEvent(electron.app.on, 'window-all-closed');

    expect(electron.app.quit).not.toHaveBeenCalled();
  });

  it('deep-link URL logging is masked (no query params)', async () => {
    mockPlatform = 'darwin';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { setupAppLifecycle } = await loadLifecycleModule();
    const electron = (await import('electron')) as unknown as {
      app: { on: ReturnType<typeof vi.fn> };
      ipcMain: { emit: ReturnType<typeof vi.fn> };
    };

    setupAppLifecycle(() => null);
    const preventDefault = vi.fn();
    emitAppEvent(
      electron.app.on,
      'open-url',
      { preventDefault },
      'audiomorph://open?token=secret&x=1',
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledWith('[lifecycle] deep-link received: audiomorph://open');
    expect(electron.ipcMain.emit).toHaveBeenCalledWith('deep-link:received', 'audiomorph://open');
  });
});
