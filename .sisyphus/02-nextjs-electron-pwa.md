# Plan: Next.js Static Export + Electron + PWA

## Architecture Decision: Static Export

`output: 'export'` is the correct choice for this app. The FastAPI sidecar handles all data/ML logic; Next.js is a pure UI shell. No SSR, no Server Actions, no API routes needed in Next.js.

**Consequences:**

- No `next/image` default loader (use `unoptimized: true` or a custom loader)
- No middleware
- No dynamic routes unless using `generateStaticParams`
- All data fetching via `fetch()` to `http://localhost:{port}/api/...`

---

## next.config.ts

```typescript
// frontend/next.config.ts
import type { NextConfig } from 'next';
import withPWA from 'next-pwa';

const isElectron = process.env.ELECTRON === 'true';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true, // Required for file:// loading
  images: { unoptimized: true }, // Required for static export
  assetPrefix: isElectron ? './' : undefined, // Relative paths for file:// protocol
  env: {
    NEXT_PUBLIC_IS_ELECTRON: isElectron ? 'true' : 'false',
  },
};

export default withPWA({
  dest: 'public',
  // Disable SW entirely in Electron — file:// has no secure context
  disable: isElectron || process.env.NODE_ENV === 'development',
  register: !isElectron,
  skipWaiting: true,
})(nextConfig);
```

---

## Build Integration

```json
// package.json scripts
{
  "scripts": {
    "build:frontend": "ELECTRON=true next build",
    "build:electron": "npm run build:frontend && electron-builder",
    "dev:frontend": "next dev",
    "dev:electron": "concurrently \"next dev\" \"wait-on http://localhost:3000 && electron .\""
  }
}
```

In dev mode, Electron loads `http://localhost:3000`. In production, it loads the static `out/` directory.

---

## Electron: Loading the Frontend

```typescript
// electron/main.ts
import { app, BrowserWindow, protocol } from 'electron';
import path from 'path';

const isDev = !app.isPackaged;

function createWindow(backendPort: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '..', 'frontend', 'out', 'index.html'));
  }

  return win;
}
```

**Note on `assetPrefix: './'`:** Without this, Next.js emits absolute `/_next/...` paths which break under `file://`. The `./` prefix makes all asset paths relative to the HTML file.

---

## Preload Script (electron/preload.ts)

```typescript
import { contextBridge, ipcRenderer } from 'electron';

// Type definitions — keep in sync with electron/ipc-types.ts
export interface ElectronAPI {
  getBackendPort: () => Promise<number>;
  platform: NodeJS.Platform;
  selectDirectory: () => Promise<string | null>;
  selectFile: (filters?: Electron.FileFilter[]) => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  onDownloadProgress: (cb: (p: DownloadProgress) => void) => () => void;
  onSetupProgress: (cb: (p: SetupProgress) => void) => () => void;
  isFirstRun: () => Promise<boolean>;
  completeSetup: () => Promise<void>;
}

export interface DownloadProgress {
  modelId: string;
  filename: string;
  downloaded: number;
  total: number;
  percent: number;
}

export interface SetupProgress {
  stage: 'detecting' | 'installing-torch' | 'installing-deps' | 'complete' | 'error';
  message: string;
  percent?: number;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendPort: () => ipcRenderer.invoke('sidecar:get-port'),
  platform: process.platform,

  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  selectFile: (filters) => ipcRenderer.invoke('dialog:select-file', filters),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),

  onDownloadProgress: (cb: (p: DownloadProgress) => void) => {
    const handler = (_: unknown, p: DownloadProgress) => cb(p);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },

  onSetupProgress: (cb: (p: SetupProgress) => void) => {
    const handler = (_: unknown, p: SetupProgress) => cb(p);
    ipcRenderer.on('setup:progress', handler);
    return () => ipcRenderer.removeListener('setup:progress', handler);
  },

  isFirstRun: () => ipcRenderer.invoke('setup:is-first-run'),
  completeSetup: () => ipcRenderer.invoke('setup:complete'),
} satisfies ElectronAPI);

// TypeScript global augmentation (in a .d.ts file)
// declare global { interface Window { electronAPI: ElectronAPI } }
```

---

## IPC Handlers (electron/ipc.ts)

```typescript
import { ipcMain, dialog, shell } from 'electron';
import { getSidecarPort } from './sidecar';
import { isFirstRun, markSetupComplete } from './setup-state';

export function registerIpcHandlers(): void {
  ipcMain.handle('sidecar:get-port', () => getSidecarPort());

  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-file', async (_, filters) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters ?? [],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('shell:open-external', async (_, url: string) => {
    // Validate URL before opening
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error(`Blocked non-http URL: ${url}`);
    }
    await shell.openExternal(url);
  });

  ipcMain.handle('setup:is-first-run', () => isFirstRun());
  ipcMain.handle('setup:complete', () => markSetupComplete());
}
```

---

## PWA for Web Deployment

When deployed as a web app (not Electron), the PWA works normally. The `ELECTRON=true` env var disables SW registration. The `manifest.json` and icons in `public/` are always included.

```json
// public/manifest.json
{
  "name": "AudioMorph Studio",
  "short_name": "AudioMorph",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#6d28d9",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## Open Questions / Decisions Needed

- [ ] **Dev workflow**: Use `wait-on` + `concurrently` for dev, or a custom dev script that starts both Next.js and Electron with hot reload?
- [ ] **Window state persistence**: Use `electron-window-state` package to remember window size/position across restarts?
- [ ] **Deep links**: Does the app need custom protocol handling (e.g., `audiomorph://open?file=...`) for OS-level file associations?
