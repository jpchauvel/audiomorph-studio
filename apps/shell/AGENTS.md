# apps/shell — Electron Main

Electron main process. Spawns Python sidecar, exposes IPC to renderer, runs hardware gate, packages app via electron-builder.

Root context: `/AGENTS.md`. This file covers shell-specific wiring.

## Critical Files

- `src/main.ts` — Electron entry. BrowserWindow + preload + lifecycle + `registerIpcBridge()`.
- `src/sidecar/manager.ts` (519 lines) — `SidecarManager`: spawn, handshake, health-poll, restart, shutdown. Resolves Python binary differently for dev vs packaged.
- `src/sidecar/logger.ts` — File logger; **masks tokens** before write.
- `src/ipc/bridge.ts` (416 lines) — `api:request` / `api:stream` handlers; forwards to `sidecar.getApiBaseUrl()` with `sidecar.getApiToken()`; SSE forwarding with streamId.
- `src/preload.ts` — `contextBridge.exposeInMainWorld('electronAPI', { request, cancel, stream, streamCancel, saveAs, openDirectory, openFile, copyFile, readFile, openExternal, showItemInFolder, getVersion, getPath, hardwareCheck, vault.* })`.
- `src/hardware/hardware-check.ts` — Calls `@audiomorph/hardware-gate`; shows "System Requirements Not Met" dialog + exits.
- `src/crash/crash-reporter.ts` — Redacts `X-Audiomorph-Token` + `Bearer` tokens from payloads.
- `src/updater/no-updater.ts` — Explicit no-op. Auto-update is forbidden product-wide.
- `electron-builder.yml` — Mac: dmg+zip arm64, `notarize: false`, `hardenedRuntime: true`. Win: NSIS x64. Linux: AppImage+deb. `afterPack: build/sign-python.js`.

## Boot Flow

1. `main.ts` creates window with `webPreferences.preload = dist/preload.js`, registers IPC bridge.
2. First renderer API call triggers `SidecarManager.getInstance().spawnAndHandshake()`.
3. Manager generates per-run hex token, spawns `python -m audiomorph --port 0 --parent-pid <pid> --auth-token <token> --handshake-{fd|file} ...`.
4. Manager reads first stdout JSON line OR handshake fd/file: `{"event":"listening","port":N,"token":"...","pid":N}`.
5. Manager stores port+token; bridge.ts forwards all `api:*` calls with `X-Audiomorph-Token` header.

## Build Order (FRAGILE)

`build:shell` runs:

```
pnpm --filter @audiomorph/ipc-contracts build && \
pnpm --filter @audiomorph/hardware-gate build && \
tsc
```

Skipping these → "Cannot find module '@audiomorph/...'" at build time.

## Tests

- `tests/e2e/` — Playwright + real Electron + real sidecar. Run: `pnpm test:e2e`. Needs `apps/sidecar/.venv` + warm HF cache for real-engine specs.
- `tests/vault/`, `tests/ipc/`, `tests/packaging/`, `tests/hardware/` — vitest unit tests.
- Config: `playwright.e2e.config.ts`.

## Release

`dist:{mac,win,linux}` → `pnpm run build:all && electron-builder --{mac|win|linux} --config electron-builder.yml`. Mac signing/notarization needs `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (release.yml passes these to `scripts/build-mac.sh`).

## Must Not

- Do NOT add auto-update logic. `no-updater.ts` is intentional.
- Do NOT log raw tokens in `sidecar/logger.ts` — masking is mandatory.
- Do NOT bypass `SidecarManager` to spawn Python directly from other modules.
- Do NOT change `webPreferences` to enable `nodeIntegration` or disable `contextIsolation`.
