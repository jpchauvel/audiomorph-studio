import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import * as path from "node:path";
import * as process from "node:process";

const APP_PROTOCOL = "audiomorph";
const DEEP_LINK_EVENT = "deep-link:received";

let isQuitting = false;

export function getPlatform(): NodeJS.Platform {
  return process.platform;
}

export function maskDeepLinkUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}

export function resolveAppIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icons", "icon.png");
  }

  return path.join(__dirname, "..", "..", "..", "..", "apps", "shell", "assets", "icon.png");
}

function extractDeepLinkFromArgv(argv: string[]): string | null {
  const candidate = argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`));
  return candidate ?? null;
}

function emitDeepLink(url: string): void {
  const maskedUrl = maskDeepLinkUrl(url);
  console.info(`[lifecycle] deep-link received: ${maskedUrl}`);
  ipcMain.emit(DEEP_LINK_EVENT, maskedUrl);
}

function applyPlatformIcon(getMainWindow: () => BrowserWindow | null): void {
  const icon = nativeImage.createFromPath(resolveAppIconPath());
  if (icon.isEmpty()) return;

  if (getPlatform() === "darwin" && app.dock) {
    app.dock.setIcon(icon);
    return;
  }

  if (getPlatform() === "win32") {
    const win = getMainWindow();
    win?.setIcon(icon);
  }
}

export function setupAppLifecycle(getMainWindow: () => BrowserWindow | null): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.setAsDefaultProtocolClient(APP_PROTOCOL);

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("browser-window-created", (_event, window) => {
    window.on("close", () => {
      // Future hide-to-tray support: this flag is the branch point.
      if (!isQuitting) {
        return;
      }
    });

    if (getPlatform() === "win32") {
      const icon = nativeImage.createFromPath(resolveAppIconPath());
      if (!icon.isEmpty()) {
        window.setIcon(icon);
      }
    }
  });

  app.on("second-instance", (_event, argv) => {
    const window = getMainWindow();
    if (window) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }

    if (getPlatform() !== "darwin") {
      const deepLink = extractDeepLinkFromArgv(argv);
      if (deepLink) {
        emitDeepLink(deepLink);
      }
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    emitDeepLink(url);
  });

  app.on("window-all-closed", () => {
    if (getPlatform() !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    const window = getMainWindow();
    if (!window) {
      void getMainWindow();
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  });

  void app.whenReady().then(() => {
    applyPlatformIcon(getMainWindow);

    if (getPlatform() !== "darwin") {
      const startupDeepLink = extractDeepLinkFromArgv(process.argv);
      if (startupDeepLink) {
        emitDeepLink(startupDeepLink);
      }
    }
  });
}
