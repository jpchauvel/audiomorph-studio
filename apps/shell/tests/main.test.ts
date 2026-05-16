import { describe, expect, it, vi, beforeAll } from 'vitest';

vi.mock('electron', () => {
  const app = {
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
    getPath: vi.fn(() => '/tmp/audiomorph-test'),
    exit: vi.fn(),
    setPath: vi.fn(),
  };
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
    on: vi.fn(),
  };
  class BrowserWindow {
    static getAllWindows = vi.fn(() => []);
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    loadURL = vi.fn(() => Promise.resolve());
    loadFile = vi.fn(() => Promise.resolve());
    once = vi.fn();
    on = vi.fn();
    show = vi.fn();
    constructor(public opts: unknown) {}
  }
  const shell = { openExternal: vi.fn(() => Promise.resolve()) };
  return { app, autoUpdater, BrowserWindow, shell };
});

beforeAll(() => {
  process.env.AUDIOMORPH_SHELL_TEST = '1';
});

describe('Electron shell main process', () => {
  it('exports a hardened webPreferences contract', async () => {
    const mod = await import('../src/main');
    expect(mod.SECURE_WEB_PREFERENCES.contextIsolation).toBe(true);
    expect(mod.SECURE_WEB_PREFERENCES.nodeIntegration).toBe(false);
    expect(mod.SECURE_WEB_PREFERENCES.sandbox).toBe(true);
  });

  it('uses 1440x900 default and 1024x720 minimum window size', async () => {
    const mod = await import('../src/main');
    expect(mod.WINDOW_DEFAULTS.width).toBe(1440);
    expect(mod.WINDOW_DEFAULTS.height).toBe(900);
    expect(mod.WINDOW_DEFAULTS.minWidth).toBe(1024);
    expect(mod.WINDOW_DEFAULTS.minHeight).toBe(720);
  });

  it('buildWindowOptions wires the security contract and a preload script', async () => {
    const mod = await import('../src/main');
    const opts = mod.buildWindowOptions();
    expect(opts.webPreferences?.contextIsolation).toBe(true);
    expect(opts.webPreferences?.nodeIntegration).toBe(false);
    expect(opts.webPreferences?.sandbox).toBe(true);
    expect(typeof opts.webPreferences?.preload).toBe('string');
    expect(opts.webPreferences?.preload).toMatch(/preload\.js$/);
  });

  it('applies platform-specific titlebar styling', async () => {
    const mod = await import('../src/main');
    const opts = mod.buildWindowOptions();
    if (process.platform === 'darwin') {
      expect(opts.titleBarStyle).toBe('hiddenInset');
    } else {
      expect(opts.frame).toBe(false);
    }
  });

  it('createWindow boots and registers hardening handlers', async () => {
    const mod = await import('../src/main');
    const win = await mod.createWindow();
    expect(win).toBeDefined();
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalled();
    expect(win.webContents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function));
  });

  it('resolves a renderer entry path under apps/renderer/out', async () => {
    const mod = await import('../src/main');
    expect(mod.resolveRendererEntry()).toMatch(/renderer\/out\/index\.html$/);
  });
});
