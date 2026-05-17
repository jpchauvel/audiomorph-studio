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

import { app, BrowserWindow, shell } from 'electron';
import * as path from 'node:path';
import * as process from 'node:process';
import { setupCrashReporter } from './crash/crash-reporter';
import { enforceHardwareRequirements, registerHardwareIpcHandler } from './hardware/hardware-check';
import { registerIpcBridge } from './ipc/bridge';
import { registerVaultHandlers } from './ipc/vault-handlers';
import { setupAppLifecycle } from './lifecycle/app-lifecycle';
import { buildMenu } from './menu/menu-builder';
import { SidecarManager } from './sidecar/manager';
import { disableAutoUpdater } from './updater/no-updater';

disableAutoUpdater();

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

  // Register show listener BEFORE loadURL/loadFile so we don't miss
  // ready-to-show firing during page load (the event is one-shot and
  // attaching after `await load*` is a race we always lose in dev).
  win.once('ready-to-show', () => win.show());

  if (isDev) {
    await win.loadURL('http://localhost:3000');
  } else {
    await win.loadFile(resolveRendererEntry());
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
    SidecarManager.getInstance({ userDataPath: app.getPath('userData') });
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
