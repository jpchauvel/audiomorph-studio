# Plan: electron-builder Configuration

## package.json Build Config

```json
{
  "name": "audiomorph-studio",
  "version": "0.1.0",
  "main": "dist/electron/main.js",
  "scripts": {
    "build": "npm run build:frontend && npm run build:electron && electron-builder",
    "build:frontend": "ELECTRON=true next build",
    "build:electron": "tsc -p tsconfig.electron.json",
    "stage-backend": "node scripts/stage-backend.cjs",
    "postinstall": "electron-builder install-app-deps"
  },
  "build": {
    "appId": "com.audiomorph.studio",
    "productName": "AudioMorph Studio",
    "copyright": "Copyright © 2026 AudioMorph",
    "directories": {
      "output": "dist-app",
      "buildResources": "build"
    },
    "files": ["dist/electron/**/*", "frontend/out/**/*", "package.json"],
    "extraResources": [
      {
        "from": "resources/python",
        "to": "python",
        "filter": ["**/*"]
      },
      {
        "from": "backend",
        "to": "backend",
        "filter": ["**/*.py", "!**/__pycache__/**", "!**/*.pyc"]
      },
      {
        "from": "resources/ffmpeg",
        "to": "bin/ffmpeg"
      }
    ],
    "asarUnpack": ["node_modules/ffmpeg-static/**"],
    "mac": {
      "target": [
        { "target": "dmg", "arch": ["arm64", "x64"] },
        { "target": "zip", "arch": ["arm64", "x64"] }
      ],
      "category": "public.app-category.music",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "notarize": {
        "teamId": "${APPLE_TEAM_ID}"
      },
      "icon": "build/icon.icns"
    },
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "icon": "build/icon.ico",
      "certificateSubjectName": "${WIN_CERT_SUBJECT}",
      "signingHashAlgorithms": ["sha256"],
      "sign": "scripts/win-sign.cjs"
    },
    "linux": {
      "target": [
        { "target": "AppImage", "arch": ["x64"] },
        { "target": "deb", "arch": ["x64"] },
        { "target": "rpm", "arch": ["x64"] }
      ],
      "icon": "build/icons",
      "category": "Audio"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "installerIcon": "build/icon.ico",
      "installerHeaderIcon": "build/icon.ico"
    },
    "dmg": {
      "contents": [
        { "x": 130, "y": 220 },
        { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
      ],
      "window": { "width": 540, "height": 380 }
    },
    "publish": {
      "provider": "github",
      "owner": "your-org",
      "repo": "audiomorph-studio",
      "releaseType": "release"
    },
    "beforeBuild": "scripts/stage-backend.cjs"
  }
}
```

---

## macOS Entitlements

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Required for Electron -->
  <key>com.apple.security.cs.allow-jit</key><true/>
  <!-- Required for Python subprocess + dynamic libs -->
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
  <!-- Network access for HF downloads -->
  <key>com.apple.security.network.client</key><true/>
  <!-- File access for model storage -->
  <key>com.apple.security.files.user-selected.read-write</key><true/>
  <key>com.apple.security.files.downloads.read-write</key><true/>
</dict>
</plist>
```

---

## Windows Signing (Azure Trusted Signing)

```javascript
// scripts/win-sign.cjs
// Called by electron-builder for each binary
const { execSync } = require('child_process');

module.exports = async function sign(config) {
  if (process.platform !== 'win32') return;
  if (!process.env.AZURE_TENANT_ID) {
    console.warn('Skipping signing: AZURE_TENANT_ID not set');
    return;
  }

  // Azure Trusted Signing via signtool + dlib
  execSync(
    `signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com ` +
      `/td SHA256 /dlib "azure-code-signing-dlib.dll" ` +
      `/dmdf "azure-signing-metadata.json" "${config.path}"`,
    { stdio: 'inherit' },
  );
};
```

Required env vars for CI:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `APPLE_TEAM_ID` (macOS)
- `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` (notarization)

---

## GitHub Actions CI Build

```yaml
# .github/workflows/build.yml
name: Build & Release

on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-14 # arm64
            platform: mac
          - os: macos-13 # x64
            platform: mac
          - os: windows-latest
            platform: win
          - os: ubuntu-22.04
            platform: linux

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        env:
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run build

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist-${{ matrix.platform }}-${{ matrix.os }}
          path: dist-app/
```

---

## Auto-Update

```typescript
// electron/updater.ts
import { autoUpdater } from 'electron-updater';
import { dialog, BrowserWindow } from 'electron';
import log from 'electron-log';

autoUpdater.logger = log;
autoUpdater.autoDownload = false; // Ask user first

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.on('update-available', (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available. Download now?`,
        buttons: ['Download', 'Later'],
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.downloadUpdate();
      });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'Restart to apply the update.',
        buttons: ['Restart Now', 'Later'],
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  // Check on startup, then every 4 hours
  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}
```

---

## Open Questions / Decisions Needed

- [ ] **Universal macOS binary**: Build separate arm64/x64 DMGs or a universal binary? Universal doubles the Python runtime size (~160MB extra).
- [ ] **Linux Flatpak**: Add Flatpak target for better sandboxing and Flathub distribution?
- [ ] **Delta updates**: electron-updater supports differential updates — worth enabling for large releases (Python runtime updates)?
- [ ] **Canary channel**: Set up a `beta` GitHub release channel for early adopters?
