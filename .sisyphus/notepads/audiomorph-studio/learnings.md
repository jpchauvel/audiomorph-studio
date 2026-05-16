## [2026-05-16] Session Init
- Project: AudioMorph Studio — Electron + Next.js + FastAPI Python sidecar + heartlib submodule
- heartlib is at /heartlib/ (submodule, read-only)
- heartlib has: examples/, src/heartlib/, pyproject.toml, assets/, uv.lock
- Target platforms: macOS Apple Silicon, Windows x64 CUDA, Linux x64 CUDA
- Python version: 3.14 (PBS bundled)
- No accounts, no telemetry, no auto-update, no cloud
- NEVER store API keys in localStorage/sessionStorage/Zustand persistence
- NEVER render raw API key after save (mask only)
- Do NOT use Jest — use Vitest
- Do NOT skip JUnit reporter
- Repo structure: apps/desktop/ apps/web/ apps/sidecar/ packages/shared-types/ packages/ui/

## [2026-05-16] P0.1 - PBS Verification Complete
- **Task:** Verify python-build-standalone 3.14 availability for 3 target platforms
- **Release:** 20260510 (Python 3.14.5)
- **Status:** ✅ Complete
- **Key Findings:**
  - All 3 target platforms have Python 3.14.5 builds available
  - macOS arm64: Verified working with fastapi 0.115.0 install test
  - Windows x64 & Linux x64: Builds available, SHA256 verified from GitHub API
  - PBS install_only variant is ~25MB (good for distribution)
  - Pip 26.1.1 included, works correctly
- **Deliverables:**
  - `docs/pbs-platform-matrix.md` - Platform matrix with URLs, SHA256, test results
  - `.sisyphus/evidence/task-P0.1-macos-pbs-verify.txt` - macOS verification output
  - `.sisyphus/evidence/task-P0.1-doc-completeness.txt` - Doc completeness check
- **Commit:** 9f4ef63 "chore(phase0): verify python-build-standalone 3.14 availability"

## [2026-05-16] FFmpeg 8.x Static Build Verification (P0.3)
- macOS arm64: evermeet.cx provides x86_64 binary (runs via Rosetta 2 on ARM)
  - Version: 8.1.1, SHA256: 543d6861b3254d344b2e2737d175bab0d55f67019263b36be2d22adb0e5a96b0
  - All 4 required codecs verified: libmp3lame, aac, flac, pcm_s16le
  - Bundle size: 17 MB (7z), extracted: 76 MB
- Windows x64 & Linux x64: BtbN/FFmpeg-Builds provides daily auto-builds
  - Version: 8.1 (latest), GPL-enabled with all dependencies
  - Windows: ffmpeg-n8.1-latest-win64-gpl-8.1.zip (~208 MB)
  - Linux: ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz (~134 MB)
  - SHA256 checksums available in BtbN releases
- All platforms confirmed for required codecs (MP3, AAC, FLAC, WAV)
- Documentation: docs/ffmpeg-platform-matrix.md created with URLs, SHA256, sizes
- Evidence files: .sisyphus/evidence/task-P0.3-{macos-version,codecs}.txt

## [2026-05-16] P0.4 heartlib API surface findings
- Music generation public entry is `HeartMuLaGenPipeline.from_pretrained(...); pipe({...})`, not a dedicated `generate_music` method.
- Generation inputs accept inline strings OR file paths for `tags` and `lyrics`; both are lowercased and tags are normalized to `<tag>...</tag>`.
- Generation output path currently writes via `torchaudio.save(..., 48000)` after `HeartCodec.detokenize`; adapter should wrap temp path and return WAV bytes.
- Lyrics transcription entry is `HeartTranscriptorPipeline` (Whisper ASR pipeline subclass) using inherited `__call__` rather than custom `transcribe()`.

## [2026-05-16] W1.5 sidecar lifecycle bootstrap
- Sidecar bootstrap now uses pre-bound loopback socket + fd handshake payload (`port`, `token`, `pid`) before `uvicorn.Server.run()`.
- Parent-death watchdog pattern: daemon thread polling every second, setting `server.should_exit` before process exit.
- Auth middleware uses `hmac.compare_digest` on `X-Audiomorph-Token`; token-leak evidence confirms known token string is absent from captured logs.

## [2026-05-16] W1.3 - Error Envelope Contract + Structured Logging
- **Task:** Define unified error envelope contract and error code catalog
- **Status:** ✅ Complete
- **Key Deliverables:**
  - `packages/shared-types/src/errors.ts`: ErrorCode enum (11 codes), ApiError interface, HTTP_STATUS mapping
  - `packages/shared-types/src/index.ts`: Re-exports for error types
  - `packages/shared-types/src/__tests__/errors.test.ts`: 5 comprehensive tests (all passing)
  - `docs/error-envelope.md`: Complete error code catalog with HTTP status, descriptions, retriable flags, usage guidelines
- **Error Codes (11 total):**
  - VALIDATION_ERROR (422), MODEL_NOT_FOUND (404), GPU_UNAVAILABLE (503), OUT_OF_MEMORY (503)
  - SIDECAR_DOWN (503), JOB_NOT_FOUND (404), CANCELLED (409), EXPORT_FAILED (500)
  - DOWNLOAD_FAILED (500), KEY_VAULT_ERROR (500), INTERNAL_ERROR (500)
- **Test Results:** 8 tests passing (5 in errors.test.ts, 3 in contracts.test.ts)
- **Verification:** All 11 error codes present in docs/error-envelope.md, HTTP_STATUS complete, ApiError interface validated
- **Commit:** f73e0de "feat(types): unified ApiError envelope + error code catalog"
- **Evidence:** `.sisyphus/evidence/task-W1.3-error-coverage.txt`

## [2026-05-16] W2.1 FastAPI app skeleton + global handlers
- `create_app(auth_token: str = "")` now wires: AuthMiddleware, localhost-only CORS regex (`^http://localhost:\d+$`), request logging middleware, global ApiError + Exception handlers, and placeholder routers (`/models`, `/jobs`, `/lyrics`, `/export`, `/settings`).
- Python-side `ApiError` class maps to shared error HTTP statuses and always emits envelope shape `{code, message, hint, retriable}`.
- Unhandled exceptions are logged via structlog with full traceback in logs only, while API response is sanitized to INTERNAL_ERROR envelope without traceback details.
- `/healthz` contract updated to `{ok, version, gpu, models_dir, python_version}` and remains auth-exempt through existing `_auth.py` exemption.
- GPU detection pattern: soft-import torch; fallback to `{available: false}` when torch is missing; use CUDA device props for `name` + `vram_gb`; use MPS availability on Apple Silicon.
- Sidecar dependencies updated for this slice: `structlog` runtime + `httpx` dev dependency for FastAPI testclient support.

## [2026-05-16] W2.2 model download manager
- Added `ModelDownloadManager` with strict required-model catalog, model_id validation (`[A-Za-z0-9_/-]`, no `..`), and containment guard to keep downloads under `<models_dir>/<repo_id>/`.
- Download path uses `huggingface_hub.snapshot_download(..., resume_download=True, max_workers=4, etag_timeout=30)` with BYOK via `HF_TOKEN` env var only; no token persistence and no token logging.
- Global download concurrency is enforced with a single `asyncio.Lock()`; jobs are queued by scheduling task then serialized during execution.
- Added disk-space precheck using `free < bytes_total*1.2` to raise `ApiError(code="DOWNLOAD_FAILED", hint="Need X GB free")` before download start.
- Added async SHA256 verification against HF metadata (`model_info(..., files_metadata=True)`) with hashing through `ThreadPoolExecutor(max_workers=4)` and state transitions to verified/corrupted.
- Implemented model router endpoints (`GET /models`, start/cancel download, verify, delete) and SSE progress stream endpoint `/models/jobs/{job_id}/events` using `EventSourceResponse` (with safe fallback for local test env).

## [2026-05-16] Post-verification fixes (healthz pid + ApiError identity)
- Added `pid: os.getpid()` to `/healthz` response so lifecycle tests can assert process identity.
- Extracted sidecar `ApiError` and `ERROR_HTTP_STATUS` into `src/audiomorph/_errors.py` to avoid class identity drift when `audiomorph.app` is reloaded in tests.
- Updated imports in `app.py`, `models/manager.py`, and tests to use the shared error module, stabilizing `pytest.raises(ApiError)` across reload boundaries.

## [2026-05-16] W2.3 generation endpoint + engine patterns
- Generation engine follows strict single-flight concurrency with a module-level singleton and an internal `asyncio.Lock`; immediate lock check returns `VALIDATION_ERROR` with 429 via a custom ApiError subclass.
- heartlib and torch are lazy-loaded only inside generation methods; pipeline is cached after first successful `from_pretrained(...)` call.
- Cancellation is modeled per-job with `asyncio.Event`; cancellation is checked before progress emissions and after thread execution, then partial `<jobs>/<job_id>/audio.wav` is deleted on cancel/failure.
- OOM recovery pattern: detect `torch.cuda.OutOfMemoryError` (plus generic runtime "out of memory"), run `torch.cuda.empty_cache()` + `gc.collect()`, retry exactly once at half duration, then return `OUT_OF_MEMORY` with actionable hint.
- Progress contract uses SSE-friendly payload `{step,total_steps,eta_s,phase}` across phases `loading|generating|encoding|finalizing`, and jobs router forwards these as SSE `progress` events with terminal `done/error` events.
- Jobs output path is centralized via new `get_jobs_dir()` in `paths.py`, ensuring all generation artifacts remain scoped to `<app_data>/jobs/<job_id>/`.

## W2.4: Lyrics Transcription Endpoint (heartlib)

- **Pattern reuse**: Mirrored `generation/engine.py` structure for `lyrics/engine.py` — separate `asyncio.Lock()`, per-job `asyncio.Event` cancel map, lazy torch/heartlib import inside methods, cached `_pipe`.
- **Concurrency reject contract**: `ApiError(code="VALIDATION_ERROR", retriable=True)` when lock held → maps to HTTP 422 via `ERROR_HTTP_STATUS`. Spec mentioned "429 behavior" semantically but the project's error-code→status map dictates 422.
- **`LyricsSegment.start/end`** typed as `int` (milliseconds) — multiplied float seconds by 1000 when normalizing heartlib `chunks[].timestamp`.
- **SSE pattern**: Reused fallback `EventSourceResponse` shim from `routers/jobs.py` for environments without `sse_starlette`.
- **Pyright pragma**: Routers wrapping engines with `Any`-typed heartlib results need `reportUnknownMemberType=false, reportUnknownArgumentType=false` (matches `routers/models.py` pattern).
- **Sparse-file test trick**: `seek(MAX+1) + write(b"\x00")` creates >50MB file for validation tests without consuming disk — keep the comment explaining the trick.
- **Device policy**: MPS → CUDA → CPU fallback; `AUDIOMORPH_REQUIRE_GPU=1` env triggers `GPU_UNAVAILABLE` error when no accelerator available.

## W2.5 — SQLite persistence (SQLModel)

- **WAL mode** must be set via `PRAGMA journal_mode=WAL` per-connection through a SQLAlchemy `event.listens_for(engine, "connect")` hook, NOT in the URL. Also set `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON` there.
- Use `Session(engine, expire_on_commit=False)` when caller reads attributes after `session_scope` exits — otherwise `DetachedInstanceError` on attribute access post-commit.
- Cache engines per DB path (module-level dict) — `create_engine` is expensive and connect-event handlers must register once per engine.
- For startup hooks, prefer FastAPI `lifespan` async context manager over deprecated `@app.on_event("startup")`.
- SQLModel table classes auto-register on `SQLModel.metadata` at import time — import `db.models` from `db.session` to ensure `create_all` sees them.
- Test concurrent WAL behavior with two `threading.Thread`s doing interleaved write/read in separate `session_scope` blocks; absence of `SQLITE_BUSY` exceptions = WAL working.

## W2.6 — Export endpoint (ffmpeg)
- ffmpeg subprocess: ALWAYS pass cmd as list to `asyncio.create_subprocess_exec(*cmd, ...)` — never `shell=True`.
- Wrap subprocess creation in try/except `FileNotFoundError` → maps to `ApiError(EXPORT_FAILED)` with install hint. The `FileNotFoundError` fires at `create_subprocess_exec` call, not at communicate().
- Use `asyncio.wait_for(proc.communicate(), timeout=...)`; on `asyncio.TimeoutError` call `proc.kill()` (swallow `ProcessLookupError`) before raising retriable=True.
- Format codec mapping lives in service, not router: wav→pcm_s16le, mp3→libmp3lame + `-b:a {N}k`, flac→flac. Default mp3 bitrate=192k.
- Router validates: format ∈ {wav,mp3,flac}; bitrate_kbps only allowed for mp3; bitrate range 64–320.
- Path resolution: NEVER trust user paths. Always look up source via `repo.get_generation_by_job_id(session, job_id)` inside `session_scope()`.
- Output path convention: `<jobs_dir>/<job_id>/export.<format>`.
- Tests pattern: monkeypatch `ffmpeg_service.asyncio.create_subprocess_exec` with a fake `_FakeProc` that writes the output file in `communicate()`. For router tests, also monkeypatch `routers.export.session_scope` and `routers.export.get_jobs_dir` to point at tmp.
- pytest-asyncio is in STRICT mode but existing tests use `asyncio.run(...)` rather than `@pytest.mark.asyncio` — matched that pattern.
- ExportRequest schema in `schemas.py` uses `job_id` (not `generation_id`). Router uses a local `_ExportBody` pydantic model to avoid coupling response shape to shared contract.

## W2.7: OpenRouter BYOK relay (2026-05-16)

- **BYOK pattern**: key arrives per-request via `X-OpenRouter-Key` header — never persisted, never logged. Read with `request.headers.get("X-OpenRouter-Key", "").strip()`, validate non-empty, forward as `Authorization: Bearer <key>` to upstream.
- **httpx + respx**: `respx` mocks `httpx.AsyncClient` requests. Use `@respx.mock` decorator + `respx.post(URL).mock(return_value=...)` or `side_effect=[...]` for sequential responses (retry tests).
- **respx not in installed deps yet**: it's listed in `pyproject.toml` dev/optional but `pip install respx` needed manually in dev env. Same with `pytest-asyncio` already installed.
- **Manual retry loop** for 5xx (no tenacity dep): `for attempt in range(_MAX_RETRIES + 1)` with exponential backoff `_RETRY_BACKOFF_BASE * (2 ** attempt)`. Close response between retries via `await response.aclose()` to free conn.
- **Streaming relay**: build request with `client.build_request` then `client.send(req, stream=True)` returning `StreamingResponse(response.aiter_bytes(), media_type=...)`. Close client + response in the generator's `finally`.
- **Log-safe pattern**: only log `model`, `stream`, `message_count`, status codes — NEVER the key, NEVER the message bodies. Tests assert key marker absent from `capsys` stdout/stderr.
- **App registration**: import router in `app.py`, add `app.include_router(openrouter_router)`. Router itself declares its own `prefix="/openrouter"`.
- **Test pattern**: use `TestClient(create_app(auth_token="test-token"))` + send both `X-Audiomorph-Token` (auth) and `X-OpenRouter-Key` (BYOK) headers.

## W2.8 — Settings + first-run state machine

- Settings keys are strict-typed via `ALL_KEYS = _STR_KEYS | _BOOL_KEYS | _ENUM_KEYS`. Unknown keys → `ApiError(VALIDATION_ERROR)`.
- Values stored as strings in SQLite via `repo.set_setting`; booleans coerced via `"true"`/`"false"` round-trip on read.
- `models_dir` requires absolute path (PurePosix OR PureWindows). Existence is NOT checked — user may pre-set.
- Secrets (HF token, OpenRouter key) are NEVER stored — only boolean `*_present` reflective flags.
- First-run state machine in `services/first_run.py`: ordered steps `pick_models_dir`, `download_models`, `first_run_completed`. `completed=True` iff `missing_steps==[]`.
- Settings router uses NO prefix (`APIRouter(tags=["settings"])`) so it can host both `/settings*` and `/first-run/status` routes.
- Test DB isolation pattern: `monkeypatch.setattr(settings_router, "session_scope", lambda: session_scope(str(db_path)))` — same pattern used by `test_export_service.py`.

### W3.1 Next.js 15 app scaffold
- Next.js 15 uses `next.config.ts` by default, configured `output: 'export'` for the Electron renderer
- We replaced `toast` from shadcn with `sonner` as `toast` is deprecated in shadcn/ui.
- Tailwind 4 natively integrates OKLCH values in `@theme inline` config without needing complex setups.
- Use `--use-bun` when invoking `create-next-app` to respect the `bun` constraint, but `pnpm workspaces` might still require `pnpm install` at root to hoist workspace dependencies smoothly.
- CSS `getComputedStyle` resolves `oklch()` CSS tokens into `lab()` values in Chromium. Tests using Playwright need to match against `lab()` if checking for token resolution programmatically.

## W3.2 — First-run wizard
- Used `'use client'` on page.tsx since it uses hooks + router
- EventSource for SSE; mock via page.route() in Playwright
- window.__AUDIOMORPH_IPC__ mocked in tests via page.addInitScript
- freeDiskGb check: < 12 GB blocks step 2 → step 3 transition
- sonner toast for errors (not shadcn toast which is deprecated)
- For Playwright tests against an exported Next.js app, test against a local http server (`bunx serve out -p 8080`) rather than `file://` because `file://` fails to load JS bundles with absolute paths (`/_next/static/...`), preventing React hydration and breaking interactivity.
- **Renderer Models Page**: Implemented the models library page with SSE downloads (`/models/jobs/{job_id}/events`), relying on `MessageEvent` for typing event stream data in TS.
- **Toaster**: Added `Toaster` from `sonner` in the root `layout.tsx` for proper toast notifications rendering. Playwright text locators failed when toasts didn't render correctly.
- **AlertDialogTrigger**: Shadcn Base UI requires manual styling and removal of `asChild` / embedded components due to missing `asChild` support in `@base-ui/react/alert-dialog` component.

### W3.4 Generation Form
- We successfully implemented a live generation form with Server-Sent Events (SSE).
- We handled tracking generation phases (idle, loading, generating, encoding, finalizing, done) using a Zustand store.
- Re-used `ShimmerButton` and `AnimatedBeam` for visual flair during generation and cancellation.
- We handled an issue where base-ui's `<Slider>` `onValueChange` sends a single value if the array size is 1 or just changes types dynamically; we unified handling by checking `Array.isArray(vals) ? vals[0] : vals`.
\n- Export dialog implemented using shadcn Dialog and Select, saving through POST /export and integrating with IPC file reveal.
\n- W3.6: Successfully implemented wavesurfer.js v7 with Next.js static export using next/dynamic with {ssr: false}.\n- Extracted Web Audio API's media element via `ws.getMediaElement()` in wavesurfer.js to power a separate SpectrumCanvas component with AnalyserNode.
- For Settings pages that manage API keys, never display the real key in the UI after saving. Always clear the input and show a placeholder instead, to maintain security.

### W3.8: Lyrics Workspace
- In Playwright tests, dynamically creating `<input type="file">` elements and triggering a click without appending them to the DOM doesn't always trigger `filechooser` events reliably or behaves poorly with visibility checks. It's safer and cleaner to render a visually hidden `<input type="file" className="hidden" />` component and call `.click()` on its ref.
- EventSource handles reconnect attempts automatically, but in Playwright it will error immediately if the endpoint doesn't exist. Be sure to mock the SSE endpoint (`**/events`) using `page.route` with an empty handler to simulate an open hanging connection while simulating SSE events from the DOM side.
\n- Implemented Prompt Assist Drawer with OpenRouter SSE streaming in Next.js/Zustand.

### W4.1 — Electron shell scaffold
- Created `apps/shell/` as the canonical Electron main-process workspace; `apps/desktop/` retained as legacy stub (untouched).
- Security contract enforced via exported `SECURE_WEB_PREFERENCES` constant + Vitest assertions — makes regression impossible without test failure.
- Used `AUDIOMORPH_SHELL_TEST` env guard around `app.whenReady()` so tests can import `main.ts` under Node without crashing on missing Electron runtime.
- electron-builder.yml uses `extraResources` to ship `apps/renderer/out/` into `Resources/renderer/out/`; `resolveRendererEntry()` resolves relative to `__dirname` (compiled `dist/`) → `../../renderer/out/index.html` which maps correctly in both dev tree and packaged `Resources/`.
- macOS uses `titleBarStyle: 'hiddenInset'`; win/linux use `frame: false` (custom titlebar in W4.x).
- Hardening defaults: `setWindowOpenHandler` denies all `window.open`, routes http(s) to `shell.openExternal`; `will-navigate` blocks any non-localhost-dev / non-file:// navigation; `setPermissionRequestHandler` denies all by default (whitelist comes in W4.4).
- pnpm-workspace.yaml: must list `apps/shell` AND root `package.json` workspaces array (bun reads npm-style, pnpm reads yaml — both updated).
- Vitest config uses dual reporters (`default` for console + `junit` for CI artifact at `.test-results/shell.xml`).
- Electron 33 + electron-builder 25 + tsx 4 + concurrently 9 — stable matrix as of 2025-Q4.

## [2026-05-16] W4.2 — Sidecar manager lifecycle (Electron shell)
- SidecarManager now owns full lifecycle: startup zombie reaping (`sidecar.pid`), spawn+JSON handshake port discovery, periodic `/healthz` probing, bounded restart policy (max 3 in 5m), and staged shutdown (`/internal/shutdown` -> SIGTERM -> SIGKILL).
- Token hygiene pattern enforced in shell logs: always sanitize process output and structured startup logging with `maskToken()` (`first_char + ***`), never emit raw auth token.
- Shell-side rotating logger pattern: daily file `logs/sidecar-YYYY-MM-DD.log`, rotate at 10MB, keep `.1`..`.5`; keeps sidecar stdout/stderr forensic history while bounding disk growth.
- Vitest process-lifecycle tests are stable when child_process/fs/http are fully mocked and handshake-timeout assertions are attached before advancing fake timers to avoid unhandled rejections.

## [2026-05-16] W4.3 — IPC bridge typed handlers + SSE forwarding
- Use a typed `handleTyped(channel, handler)` wrapper around `ipcMain.handle` to keep channel payload/response contracts aligned with a shared `@audiomorph/ipc-contracts` map.
- Cancellation pattern: maintain separate `Map<string, AbortController>` for request IDs and stream IDs; always delete controllers in `finally` blocks to avoid stale abort references.
- SSE forwarding from main process is reliable when parsing `event:` and multi-line `data:` frames, flushing on blank line boundaries, and emitting terminal `api:stream:end` on normal close or cancel.
- Security boundaries enforced in main process: inject bearer token only in `fetch` headers; never include token in return payloads/logs; restrict file paths to `userData` + sidecar tmp roots and restrict URL hosts via explicit allowlist.
- Workspace package gotcha: `@audiomorph/ipc-contracts` must emit declarations (`dist`) before shell build so imports resolve under shell `rootDir` constraints.

## [2026-05-16] W4.4 — Preload bridge typed `window.electronAPI`
- Added `ElectronAPI` and window-facing alias types to `@audiomorph/ipc-contracts` so preload + renderer can share one typed contract (`ApiRequestArgs`, `ApiResponse`, `ApiStreamArgs`, `StreamEvent`, `StreamError`, dialog/fs aliases).
- Preload bridge should expose only narrowly scoped wrapper methods over `ipcRenderer.invoke`/`ipcRenderer.on`; do not surface raw `ipcRenderer` or Node globals.
- Stream bridge pattern: start via `api:stream` invoke, subscribe with `ipcRenderer.on` to `api:stream:event|end|error`, filter every callback by `streamId`, and return a cleanup function that removes all three listeners and invokes `api:stream:cancel`.
- Renderer compatibility pattern: declare `window.electronAPI?: ElectronAPI` (optional) in `apps/renderer/types/electron.d.ts` so browser-only contexts remain valid.
- Build ordering gotcha confirmed: after changing `packages/ipc-contracts/src/index.ts`, run `bun run build` in `packages/ipc-contracts` before `bun run build:shell` so shell sees updated exported declaration members.

## [2026-05-16] W4.5 — Key vault via Electron safeStorage
- Key vault file pattern: persist a JSON map of base64 ciphertext at `<userData>/vault.enc`, but always write atomically (`vault.enc.tmp` -> `rename`) to avoid corruption on crashes.
- `safeStorage.isEncryptionAvailable()` can be false in CI/headless; fallback should still be base64-only (never plaintext), log warning, and keep API non-throwing for graceful operation.
- Security boundary: renderer-facing IPC must never return decrypted secret values; `vault:get` should return `{present:boolean}` only. Decrypted value retrieval belongs to main-process-only function (`getSecretForSidecar`).
- Audit pattern: append-only JSONL in `<userData>/logs/vault-audit.log` with `{action,key?,present?/found?,ts,pid}`; never include secret material in logs.
- Contract sync rule: when adding IPC channels, update all three in lockstep — `packages/ipc-contracts` (`IpcInvokeMap` + `ElectronAPI`), shell preload bridge, and main-process handlers/tests.

## [2026-05-16] W4.6 — Shell lifecycle + native menu wiring
- Added `setupAppLifecycle(getMainWindow)` module to centralize single-instance lock, `second-instance` focus/restore behavior, `window-all-closed` macOS guard, `activate` handling, protocol registration, and deep-link stub forwarding via `ipcMain.emit("deep-link:received", maskedUrl)`.
- Deep-link hardening rule implemented: URLs are masked before logging (`?query` stripped) and only logged/emitted; no navigation side effects.
- Runtime icon strategy: `resolveAppIconPath()` uses `<resourcesPath>/icons/icon.png` in packaged builds and `<repo>/apps/shell/assets/icon.png` in dev. Applied for macOS dock (`app.dock.setIcon`) and Windows window icon (`setIcon`); Linux left to builder config.
- Added `buildMenu(mainWindow)` with platform-specific templates: full macOS app/file/edit/view/window/help menu and minimal win/linux file/edit/view/help menu. DevTools/reload are dev-only (`NODE_ENV !== "production"`), and Help Learn More is allowlisted to the project GitHub URL.
- Main-process wiring pattern updated: lifecycle setup now happens before `app.whenReady()`, while menu creation is bound after each window creation to ensure native menu exists and updates when a new main window is created.
- Test mocking gotcha: if `createWindow()` now uses `win.on("closed")`, legacy BrowserWindow test doubles must include `on` to avoid regressions in unrelated `main.test.ts` assertions.

## [2026-05-16] W4.7 — local crash reporter + no-updater hard guard
- Crash reporter setup now sets crash dump path via `app.setPath("crashDumps", <userData>/logs/crashes)` and starts Electron crashReporter with `submitURL: ""`, `uploadToServer: false`, `compress: true` (local-only, no telemetry).
- Main-process crash handlers (`uncaughtException`, `unhandledRejection`) persist sanitized JSON reports (`crash-<ISO>.json`) and terminate with `app.exit(1)` (never `process.exit`).
- Crash report sanitization strips `Bearer <token>` and `X-Audiomorph-Token: <token>` patterns before writing to disk.
- Auto-update hard guard centralizes updater disabling: forces `autoDownload=false`, `autoInstallOnAppQuit=false`, overrides `checkForUpdates`/`checkForUpdatesAndNotify` with warning no-ops, and logs on `update-available` without download side effects.
- `main.ts` now invokes `disableAutoUpdater()` at module startup and `setupCrashReporter(app.getPath("userData"))` early in `app.whenReady()` lifecycle.


## [2026-05-16] W5.4 — Hardware gating package + 3-tier enforcement
- Added new workspace package `@audiomorph/hardware-gate` with `detect()` returning a typed `HardwareReport`/`HardwareFailure` contract, using `execFile` only (no shell) and OS-specific probes.
- Threshold checks are done on raw numeric values (not rounded display values) so exact boundary behavior is correct: 16.0 GB passes, 15.9 GB fails; report details are rounded for UI readability.
- Linux/Windows CUDA probe now uses `nvidia-smi` discovery fallback order (PATH first, then common install paths) and emits explicit `nvidia_gpu`/`cuda` failures.
- Shell first-launch hard gate added in `enforceHardwareRequirements()` before window creation; on failure it shows `dialog.showErrorBox` and calls mandatory `app.exit(1)`.
- Added dedicated IPC channel `hardware:check` and preload API `hardwareCheck()`; kept renderer safe for browser context by checking optional `window.electronAPI`.
- Added renderer diagnostics page at `/diagnostics` with pass/fail banner + threshold table and settings link entry; styling uses Tailwind + project OKLCH token classes.
- Build-order gotcha: shell now builds `@audiomorph/ipc-contracts` and `@audiomorph/hardware-gate` before compiling shell TS to avoid missing workspace type/module declarations.
- Test coverage added for hardware-gate detection matrix and shell enforcement/IPC behavior; shell suite remains green with 69 passing tests.

## [2026-05-16] W5.1 — macOS installer
- `electron-builder.yml` mac targets should be explicit arm64-only objects for both dmg and zip; keep `hardenedRuntime: true` and `gatekeeperAssess: false`, then add `entitlements`, `entitlementsInherit`, `notarize: true`, and `afterPack` hook path.
- `build/entitlements.mac.plist` should use Apple full entitlement keys under `<dict>` with `<true/>` values: unsigned executable memory, JIT, disable library validation, and dyld env vars.
- AfterPack signing hook pattern: recurse `Contents/Resources/python`, detect signable files by Mach-O magic (including fat binaries), and invoke `codesign` via `execFile`/`promisify` only (no shell, no `--deep`).
- Hook must no-op when the packaged `python/` directory is absent to avoid failing non-Python packaging paths.
- Packaging tests can validate shell env guard logic by checking required var strings and a pure test helper for fail/pass scenarios; keep JUnit output at `.test-results/shell.xml`.

## [2026-05-16] W5.2 — Windows installer
- NSIS custom scripts hook via electron-builder `nsis.include: build/installer.nsh`
- Use `!macro customInit` / `!macroend` — electron-builder injects this into `.onInit`
- PowerShell exec from NSIS: `nsExec::ExecToStack 'powershell -NoProfile -ExecutionPolicy Bypass -Command "..."'`; pop $0=exit code, $1=stdout
- Single-quote PowerShell string args by doubling: `''*NVIDIA*''`
- For NVIDIA GPU detection: `Get-CimInstance Win32_VideoController | Where-Object {$_.Name -like '*NVIDIA*'}` — NEVER use deprecated wmic
- electron-builder picks up `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` env vars automatically — no script logic needed
- Vitest yml assertions via regex `toMatch(/^\s{2}key:\s*value\s*$/m)` work when no yaml parser is installed
- Tests negating a word (e.g. `not.toMatch(/\bwmic\b/i)`) must avoid mentioning that word even in comments of the file under test
