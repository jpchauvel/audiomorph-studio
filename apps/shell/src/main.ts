/**
 * AudioMorph Studio - Electron main process entry.
 *
 * Security contract (W4.1):
 *   - contextIsolation: true   (always)
 *   - nodeIntegration: false   (always)
 *   - sandbox: true            (always)
 *   - preload: dist/preload.js (renderer<->main bridge stub for W4.4)
 *
 * Window:
 *   - 1440x900 default, minimum 1024x720
 *   - macOS: hiddenInset titlebar
 *   - win/linux: frameless (custom titlebar wired later)
 *
 * Loader:
 *   - dev:  http://localhost:3000 (Next.js renderer)
 *   - prod: file://<resourcesPath>/renderer/index.html (static export)
 */

import { app, BrowserWindow, protocol, shell } from 'electron';
import * as path from 'node:path';
import * as process from 'node:process';
import { setupCrashReporter } from './crash/crash-reporter';
import { enforceHardwareRequirements, registerHardwareIpcHandler } from './hardware/hardware-check';
import { registerIpcBridge } from './ipc/bridge';
import { registerVaultHandlers } from './ipc/vault-handlers';
import { setupAppLifecycle } from './lifecycle/app-lifecycle';
import { buildMenu } from './menu/menu-builder';
import { AUDIOMORPH_SCHEME, registerAudiomorphProtocol } from './protocol/audiomorph-protocol';
import { SidecarManager } from './sidecar/manager';
import { disableAutoUpdater } from './updater/no-updater';

disableAutoUpdater();

if (
  app &&
  typeof app.whenReady === 'function' &&
  !process.env.AUDIOMORPH_SHELL_TEST &&
  protocol &&
  typeof protocol.registerSchemesAsPrivileged === 'function'
) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIOMORPH_SCHEME,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true,
      },
    },
  ]);
}

const isDev = process.env.NODE_ENV === 'development';
let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = BrowserWindow.getAllWindows()[0] ?? null;
  return mainWindow;
}

export const WINDOW_DEFAULTS = {
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 720,
} as const;

export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const;

export function resolvePreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

export function resolveRendererEntry(): string {
  return path.join(__dirname, '..', '..', 'renderer', 'out', 'index.html');
}

export function buildWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const base: Electron.BrowserWindowConstructorOptions = {
    width: WINDOW_DEFAULTS.width,
    height: WINDOW_DEFAULTS.height,
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    show: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: SECURE_WEB_PREFERENCES.contextIsolation,
      nodeIntegration: SECURE_WEB_PREFERENCES.nodeIntegration,
      sandbox: SECURE_WEB_PREFERENCES.sandbox,
      preload: resolvePreloadPath(),
    },
  };

  if (process.platform === 'darwin') {
    base.titleBarStyle = 'hiddenInset';
  } else {
    base.frame = false;
  }

  return base;
}

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow(buildWindowOptions());
  mainWindow = win;
  let didShowWindow = false;

  const showWindow = (): void => {
    if (didShowWindow || win.isDestroyed()) {
      return;
    }
    didShowWindow = true;
    win.show();
    win.focus();
  };

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  // Harden: block opening arbitrary new windows; route external links to OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Harden: block navigation away from our app origin.
  win.webContents.on('will-navigate', (event, navUrl) => {
    const allowed =
      (isDev && navUrl.startsWith('http://localhost:3000')) || navUrl.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      if (navUrl.startsWith('https://')) void shell.openExternal(navUrl);
    }
  });

  win.once('ready-to-show', showWindow);
  win.webContents.once('did-finish-load', showWindow);
  win.webContents.once('did-fail-load', () => {
    showWindow();
  });

  const showFallbackTimer = setTimeout(
    () => {
      showWindow();
    },
    isDev ? 15000 : 5000,
  );

  win.once('closed', () => {
    clearTimeout(showFallbackTimer);
  });

  try {
    if (isDev) {
      await win.loadURL('http://localhost:3000');
    } else {
      await win.loadFile(resolveRendererEntry());
    }
    showWindow();
  } catch {
    showWindow();
    if (!win.isDestroyed()) {
      await win.loadURL(
        `data:text/html;charset=UTF-8,${encodeURIComponent('<!doctype html><title>AudioMorph Studio</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#0a0a0a;color:#e5e7eb;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px}p{opacity:.85;max-width:560px}</style><main><h1>Renderer failed to load</h1><p>The app window started, but the renderer could not be reached. Keep the dev server running and restart the app.</p></main>')}`,
      );
      showWindow();
    }
  } finally {
    clearTimeout(showFallbackTimer);
  }

  return win;
}

// Only wire Electron lifecycle when actually running under Electron
// (skip during unit tests which import this module under Node).
if (app && typeof app.whenReady === 'function' && !process.env.AUDIOMORPH_SHELL_TEST) {
  setupAppLifecycle(getMainWindow);

  app.whenReady().then(async () => {
    setupCrashReporter(app.getPath('userData'));
    await enforceHardwareRequirements();
    // Eager fire-and-forget boot: matches documented intent in apps/shell/AGENTS.md.
    // Window opens in parallel; manager emits 'sidecar:ready' and handles its own
    // errors. The renderer's first /models call may land before handshake on slow
    // boots; that produces a one-off toast which the user has accepted as the
    // tradeoff for fastest first paint.
    const sidecar = SidecarManager.getInstance({ userDataPath: app.getPath('userData') });
    sidecar.start().catch((err: unknown) => {
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error(`[main] sidecar.start() failed: ${message}`);
    });
    sidecar.once('sidecar:ready', () => {
      try {
        registerAudiomorphProtocol(protocol, {
          getApiBaseUrl: () => sidecar.getApiBaseUrl(),
          getApiToken: () => sidecar.getApiToken(),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
        console.error(`[main] registerAudiomorphProtocol failed: ${message}`);
      }
    });
    registerIpcBridge();
    registerHardwareIpcHandler();
    registerVaultHandlers();
    void createWindow().then((window) => {
      buildMenu(window);
    });

    app.on('activate', () => {
      const existing = getMainWindow();
      if (existing) {
        existing.focus();
        return;
      }

      void createWindow().then((window) => {
        buildMenu(window);
      });
    });
  });

  // Harden: deny all permission requests by default (W4.4 will whitelist).
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });
  });
}

export { createWindow };
