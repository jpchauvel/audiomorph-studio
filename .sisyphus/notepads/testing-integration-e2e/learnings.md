# Learnings — testing-integration-e2e

## [2026-05-16] Session ses_1cef35312ffeupqA90Up40ilE2 — Init
- HEAD: efa4f08 on main; clean tree
- Existing renderer playwright.config.ts: `bun x serve@latest out -l 3000` (static export)
- Sidecar handshake: first stdout line `{"event":"listening","port":N,"token":"..."}` with `--port=0`
- Auth header: `X-Audiomorph-Token` (NOT `Authorization: Bearer`)
- Test token: `test-token-deterministic-do-not-use-in-prod`
- Planted scrubber token: `sk-or-v1-PLANTED-FAKE-TEST-TOKEN`
- Test-mode IPC channel: `__audiomorph_test:get-sidecar-info`
- Route-ready signal: `data-testid="route-ready"` on each route layout
- JUnit output pattern: `.test-results/{layer}.xml`
- Snapshot path: `__snapshots__/{platform}/{testFilePath}/{arg}{ext}`
- WAV header: `RIFF....WAVE` byte signature
- HF cache layout: `~/.cache/huggingface/hub/models--{org}--{name}/snapshots/{sha}/`
- Workspace uses pnpm + bun; sidecar uses Python/pytest
- No Jest — Playwright/Vitest only
- No CSS-in-JS, no raw hex/rgb — OKLCH tokens + Tailwind only
- No Google Fonts — geist npm package only
- NEVER log HF_TOKEN or OpenRouter key
- NEVER shell=True in subprocess
- NEVER hardcode http://127.0.0.1:PORT — read from window.__AUDIOMORPH_API_BASE__
- Token NEVER reaches renderer

## [2026-05-16] @audiomorph/test-helpers workspace package scaffolded
- Created `packages/test-helpers/` with ESM-only structure (`"type": "module"`)
- Exports map with both `import` and `types` conditions for: sidecar, scrubber, hf-cache, electron, test-mode, fixtures
- Stub files use `export {}` to mark as modules (TypeScript requirement)
- tsconfig extends `../../tsconfig.base.json` with `rootDir: ./src`, `outDir: ./dist`
- devDependencies: `@playwright/test`, `@types/node`, `typescript`
- pnpm-workspace.yaml already had `packages/*` glob — no modification needed
- `pnpm install` wired workspace links successfully
- `pnpm typecheck` passes with no errors
- Commit: c7af498 "test(helpers): scaffold @audiomorph/test-helpers workspace package"

## [2026-05-16] HF model manifest and cache helper implemented
- Created `apps/sidecar/scripts/required-models.json` with 2 models:
  - facebook/musicgen-small (SHA: 4c8334b02c6ec4e8664a91979669a501ec497792, 1400 MB)
  - openai/whisper-tiny (SHA: 169d4a4341b33bc18d8881c4b69c2e104e1cc0af, 140 MB)
- Implemented `packages/test-helpers/src/hf-cache.ts` with 4 exports:
  - `getCacheKey(manifest)`: SHA256 hash of manifest JSON (deterministic)
  - `loadManifest()`: Loads from AUDIOMORPH_MANIFEST_PATH env var or default path
  - `getCachedModelPath(id, revision)`: Constructs HF cache path using HF_HOME env var
  - `verifyModelManifest(manifest)`: Filesystem-only check, returns {ok, missing?}
- Schema validation: throws on missing `revision` or invalid SHA length (not 40 chars)
- All functions use ESM imports (no CommonJS)
- 9 vitest unit tests pass (determinism, schema validation, missing detection, path construction)
- Evidence files created in `.sisyphus/evidence/task-2-*.txt`

## [2026-05-16] Secret scrubber helper implemented
- Implemented `packages/test-helpers/src/scrubber.ts` with 5 secret pattern matchers:
  - `X-Audiomorph-Token: \S+` (AUDIOMORPH_TOKEN)
  - `Authorization: Bearer \S+` (BEARER_TOKEN)
  - `sk-or-[a-zA-Z0-9-]+` (OPENROUTER_KEY)
  - `hf_[a-zA-Z0-9]+` (HUGGINGFACE_TOKEN)
  - `Bearer [A-Za-z0-9._-]{20,}` (GENERIC_BEARER)
- Exports: `SECRET_PATTERNS`, `scrubSecrets(text)`, `scrubFile(path)`, `scrubDirectory(dir)`
- `scrubSecrets(text)`: Returns {replacements: number}, replaces with [REDACTED-<pattern-name>]
- `scrubFile(path)`: Atomic writes via temp file + fs.rename, returns {replacements: number}
- `scrubDirectory(dir)`: Recursive, skips node_modules and hidden dirs, returns {filesProcessed, replacements}
- Created `packages/test-helpers/bin/scrubber-cli.js` with #!/usr/bin/env node shebang (executable)
- Updated `package.json` with `"bin": { "scrubber-cli": "./bin/scrubber-cli.js" }`
- 22 vitest unit tests pass (all patterns, idempotency, atomic writes, directory recursion)
- Evidence files: task-3-scrub-planted-secrets.txt, task-3-idempotent.txt, task-3-clean-unchanged.txt
- Commit: "test(scrubber): add secret redaction helper with CLI"

## [2026-05-16] Test fixtures created and getFixturePath implemented
- Created fixture directory structure: `packages/test-helpers/fixtures/{audio,lyrics,openrouter}/`
- Audio fixtures:
  - `short.wav`: 1-second silent mono PCM at 44100 Hz, 16-bit (86 KB) — generated via ffmpeg lavfi anullsrc
  - `short.mp3`: 1-second silent mono MP3 at 44100 Hz (4.3 KB) — generated via ffmpeg lavfi anullsrc with MP3 encoding
  - `speech-3s.wav`: 3-second silent mono PCM at 44100 Hz, 16-bit (258 KB) — generated via Python wave module (espeak-ng not available)
- Lyrics fixtures:
  - `sample.txt`: 42 lines, 3 verses + chorus structure, ~1 KB
  - `empty.txt`: 0 bytes (empty file)
- OpenRouter fixtures:
  - `chat-response.json`: Valid OpenRouter chat completion response with id, object, created, model, choices, usage
  - `error-401.json`: Valid OpenRouter 401 error response with error.message, error.type, error.code
- Implemented `packages/test-helpers/src/fixtures.ts`:
  - `getFixturePath(category, name): string` — returns absolute path using import.meta.url (ESM-compatible)
  - Uses fileURLToPath + dirname for path resolution
  - Resolves to `packages/test-helpers/fixtures/{category}/{name}`
- Created `.gitattributes` with binary markers: `*.wav binary`, `*.mp3 binary`, `*.png binary`
- Total fixture size: 832 blocks (~427 KB), well under 500 KB limit
- All WAV files have valid RIFF headers: `5249 4646 ... 5741 5645` (RIFF....WAVE)
- TypeScript build passes with no errors
- Path resolution tested: all 7 fixture paths resolve correctly to absolute paths
- Evidence files: task-6-fixture-validity.txt, task-6-path-resolution.txt

## [2026-05-16] Playwright config split: component/integration/visual + E2E config
- Split `apps/renderer/playwright.config.ts` into 3 configs:
  - `playwright.component.config.ts`: testDir `tests/component/`, webServer enabled, retries 0
  - `playwright.integration.config.ts`: testDir `tests/integration/`, NO webServer, retries 0, timeout 60s
  - `playwright.visual.config.ts`: testDir `tests/visual/`, webServer enabled, retries 0, snapshotPathTemplate with {platform}
- Created `apps/shell/playwright.e2e.config.ts`: testDir `tests/e2e/`, NO webServer, retries 1, timeout 120s
- Added 8 root package.json scripts: test:component, test:integration, test:visual, test:visual:update, test:e2e, test:e2e:debug, test:sidecar-integration, test:all
- All 25 component tests pass (no regression)
- Integration config verified: grep -c "webServer" = 0 ✓
- JUnit output pattern: `.test-results/{layer}.xml` (component, integration, visual, e2e, sidecar-integration)
- Deleted original `apps/renderer/playwright.config.ts` after split
- `.test-results/` already in `.gitignore` (line 25)
- Evidence files: task-7-scripts-resolve.txt, task-7-component-config.txt, task-7-no-webserver.txt

## [2026-05-16] T5: Existing renderer tests relocated to tests/component/
- Task: Move 10 existing .spec.ts files from apps/renderer/tests/e2e/ to apps/renderer/tests/component/
- Pre-move state: 25 tests in 10 spec files at tests/e2e/
- Method: Used git mv (preserves history) — all 10 files moved as renames
- Files moved:
  - export.spec.ts, first-run.spec.ts, generation.spec.ts, lyrics.spec.ts, models.spec.ts
  - player.spec.ts, prompt-assist.spec.ts, scaffold.spec.ts, screenshot.spec.ts, settings.spec.ts
- Post-move verification:
  - ✓ 10 files in tests/component/
  - ✓ 0 files at tests/ root
  - ✓ 25 tests still pass (no logic modified)
  - ✓ Git history preserved (git log --follow shows pre-move commits)
- Config already updated by T7: playwright.component.config.ts points to tests/component/
- No relative import updates needed (all imports use @playwright/test or absolute paths)
- Commit: bc1f876 "test(scrubber): add secret redaction helper with CLI" (includes T5 moves)
- Evidence files: task-5-relocation-counts.txt, task-5-tests-still-pass.txt, task-5-history-preserved.txt, task-5-final-verification.txt

## [2026-05-16] AUDIOMORPH_TEST_MODE sentinel and 6 product hooks implemented
- Task: Implement test-mode sentinel in `packages/test-helpers/src/test-mode.ts` and add 6 product hooks
- Sentinel exports (6 total):
  - `TEST_MODE_ENV = 'AUDIOMORPH_TEST_MODE'`
  - `TEST_TOKEN = 'test-token-deterministic-do-not-use-in-prod'`
  - `TEST_VAULT_MODE = 'memory'`
  - `isTestMode(): boolean` — checks process.env.AUDIOMORPH_TEST_MODE === "1"
  - `assertTestMode(): void` — throws if not in test mode
  - `getTestEnv(): Record<string, string>` — returns {AUDIOMORPH_TEST_MODE: "1", ...}
- Product hooks (6 total, grep count verified):
  1. `apps/sidecar/src/audiomorph/__main__.py` (line 45–51) — CI safety check: exit 78 if CI=true and no test mode
  2. `apps/sidecar/src/audiomorph/_auth.py` (line 28–32) — accept test token when AUDIOMORPH_TEST_MODE=1
  3. `apps/shell/src/sidecar/manager.ts` (line 165–172) — propagate AUDIOMORPH_TEST_MODE=1 env to spawned sidecar
  4. `apps/shell/src/preload.ts` (line 135–137) — expose __AUDIOMORPH_TEST_MODE__ to renderer window
  5. `apps/sidecar/src/audiomorph/app.py` (line 128–142) — add test_mode flag to healthz endpoint
  6. `apps/shell/src/lifecycle/app-lifecycle.ts` (line 66–70) — log test mode enabled at startup
- Verification:
  - ✓ grep -r "AUDIOMORPH_TEST_MODE hook" apps/ | wc -l = 6
  - ✓ All 53 existing sidecar pytest tests pass (no regression)
  - ✓ Each hook marked with required comment marker (TypeScript: //, Python: #)
  - ✓ Test token exact string used: 'test-token-deterministic-do-not-use-in-prod'
  - ✓ CI safety check exits code 78 with stderr "AUDIOMORPH_TEST_MODE required in CI"
  - ✓ Token never reaches renderer (only flag exposed)
  - ✓ ESM only (no CommonJS require)
  - ✓ No production logic changed outside test-mode guards
- Evidence files: task-4-ci-refuse.txt, task-4-test-token-auth.txt, task-4-no-regression.txt
- Commit: "test(test-mode): add AUDIOMORPH_TEST_MODE sentinel and product hooks"

## T8 — Shared sidecar spawn helper (sidecar.ts)

- Real sidecar spawn contract lives in `apps/shell/src/sidecar/manager.ts:171-191`:
  command `python -m audiomorph.main --port 0 --token <token>`, cwd `apps/sidecar/`,
  stdio `["ignore","pipe","pipe"]`, first stdout line is JSON
  `{event:"listening", port:<int>, token:<str>}`. The plan-doc reference to
  module name `audiomorph_sidecar` is stale — actual module path is `audiomorph.main`.
- The Python module `audiomorph.main` does NOT exist on disk yet; `apps/sidecar/src/audiomorph/`
  has `__main__.py` (different handshake protocol via `--handshake-fd`). The shell
  manager and the new test-helper are coded against the future `main.py` entrypoint.
  Tests therefore use a tiny inline Python mock script invoked via the helper's
  `AUDIOMORPH_TEST_SPAWN_BIN` + `AUDIOMORPH_TEST_SPAWN_CMD` test hooks.
- Test hooks added to the helper (env-var driven, no API surface change):
  - `AUDIOMORPH_TEST_NO_HANDSHAKE=1` → helper skips reading stdout (forces timeout).
  - `AUDIOMORPH_TEST_TOKEN_OVERRIDE=<str>` → helper asserts handshake token equals this.
  - `AUDIOMORPH_TEST_SPAWN_BIN` + `AUDIOMORPH_TEST_SPAWN_CMD` (JSON array) → override
    spawn binary + argv, lets tests inject mock sidecars without `.venv` or real Python module.
- Cleanup pattern: `spawnSidecar()` wraps the entire handshake in try/catch; on any
  failure (timeout, JSON parse, token mismatch) it calls `killChild()` (SIGTERM →
  5s wait → SIGKILL) BEFORE re-throwing. Verified by mock that writes its own PID
  to a temp file; post-rejection `process.kill(pid, 0)` confirms reaping.
- Vitest module-property assignment (`(cp as any).spawn = wrap`) is NOT possible —
  ESM modules are frozen. Use PID-file pattern instead of monkey-patching `spawn`.
- ESM gotcha: helper imports `./test-mode.js` (with `.js` extension) — TypeScript
  `NodeNext` resolution requires the runtime extension in source.
- `waitForSidecarReady(baseUrl, token, timeoutMs=10000)` polls `GET /health` every
  200ms with `X-Audiomorph-Token` header (NOT Bearer). Matches sidecar auth contract.

## T9 — Electron launch helper (2026-05-16)

- Playwright's `_electron.launch()` accepts `executablePath`, `args`, `env`,
  `timeout`. The first positional arg in `args` is the path to the Electron
  main JS entry; everything after is forwarded to the app.
- `app.evaluate(fn)` runs `fn` in the Electron **main** process, receiving
  the `electron` module as its arg. We use `ipcMain.listeners(channel)` to
  pull the registered handler and invoke it directly — this avoids needing
  a renderer round-trip for test introspection.
- Test-mode IPC channel `__audiomorph_test:get-sidecar-info` lives in
  `apps/shell/src/ipc/bridge.ts` and is gated by
  `process.env.AUDIOMORPH_TEST_MODE === '1'`. It is **never** exposed via
  `contextBridge` in preload — only the main process can invoke it. This
  keeps the renderer attack surface unchanged in production builds.
- Electron binary resolution order: env override
  (`AUDIOMORPH_TEST_ELECTRON_BIN`) → platform-specific path inside
  `apps/shell/node_modules/electron/dist/` → `.bin/electron`. macOS uses
  the `Electron.app/Contents/MacOS/Electron` symlink target.
- Sidecar cleanup verification uses `/healthz` polling against the
  reported sidecar port. Default timeout is 10s with 200ms polling
  interval, overridable via `cleanupTimeoutMs` per-call (essential for
  fast unit tests that simulate cleanup failure).
- Avoid `vi.spyOn(http, 'request')` for testing internal http polling —
  `node:http` exports are non-configurable in ESM, causing
  "Cannot redefine property: request" errors. Use a real ephemeral
  `http.createServer()` instead. This is the same pattern the sidecar
  helper uses for handshake tests.
- Avoid spying on `globalThis.setTimeout` to speed up tests; it's brittle
  and conflicts with vitest's own scheduling. Instead, expose timeout
  options on the production API (e.g., `cleanupTimeoutMs`) so tests can
  pass small values directly.
- Test-helpers package is ESM-only with NodeNext module resolution; all
  internal imports must use `.js` extension (e.g., `./test-mode.js`).
- The fake-launcher pattern (`makeFakeLauncher`) lets us unit-test the
  full happy-path and error paths of `launchElectronApp` without ever
  spawning Electron. Real Electron boot is deferred to T14 e2e.

## T10 — Renderer integration journey specs

- Six journey specs at `apps/renderer/tests/integration/journey-*.spec.ts`
  share `_setup.ts` which exports `createSidecarFixture()` — a Playwright
  fixture extension providing `sidecar`, `staticServer`, and `apiBase`.
- Static server: prefer `bunx --bun serve`, fall back to `npx --yes serve`.
  Bind to port 0 and parse stdout for `http://127.0.0.1:<port>`; never
  hard-code 3000.
- `_setup.ts` injects `window.__AUDIOMORPH_API_BASE__` and
  `window.__AUDIOMORPH_TOKEN__` via `page.addInitScript()` so the renderer
  bundle (which expects these globals) can reach the spawned sidecar.
- Test-helpers is ESM-only and lives outside the renderer's CJS context.
  Solution: nested `apps/renderer/tests/integration/package.json` with
  `"type": "module"`, plus NodeNext-style `./_setup.js` import extension.
  Without this, Playwright's CJS transform collides with test-helpers'
  ESM-only `"type": "module"` and throws `ReferenceError: exports is not
  defined in ES module scope` at the first `import`.
- `__dirname` not available in ESM specs; reconstruct via
  `path.dirname(fileURLToPath(import.meta.url))`.
- Skip-gate pattern: both `RENDERER_BUILD_PRESENT` (out/index.html exists)
  and `SIDECAR_RUNTIME_PRESENT` (.venv/bin/python exists) are checked at
  spec top via `test.skip(...)`. Suite is green-skipped when either is
  absent, matching CI environments without Python.
- Lyrics spec boots a local `http.createServer` returning the static
  OpenRouter fixture; the sidecar would receive the stub URL via
  `AUDIOMORPH_OPENROUTER_BASE_URL` `extraEnv`, but the wiring of that env
  through to the sidecar's OpenRouter client is the sidecar's job — the
  test only guarantees the stub is reachable and the lyrics route loads.
- Token leak assertion: `expect(await page.content()).not.toContain(TEST_TOKEN)`
  catches any accidental rendering of the auth token into the DOM.
- Auth header convention enforced: only `X-Audiomorph-Token`, never
  `Authorization: Bearer` (see journey-settings.spec.ts authProbe).

## T11 — Sidecar pytest integration suite (2026-05-16)
- 7 files + conftest under `apps/sidecar/tests/integration/`, 25 tests, exit 0,
  JUnit at `.test-results/sidecar-integration.xml`. 53 unit tests still pass.
- `OPENROUTER_URL` in `routers/openrouter.py` is a hardcoded module constant
  with NO env-var override. Stubbing requires
  `monkeypatch.setattr(or_router, "OPENROUTER_URL", stub_url)` per-test;
  setting `AUDIOMORPH_OPENROUTER_BASE_URL` env is a no-op today.
- User-data env var is `AUDIOMORPH_DATA_DIR` (not `AUDIOMORPH_USER_DATA_DIR`).
  `db.session._engine_cache: dict[str, Engine]` must be `.clear()`ed before and
  after each test, AND `init_db(path)` re-called, otherwise stale engine is
  reused and tests share state.
- `routers/jobs.py` does `_ENGINE = get_engine()` at import. Patch on the
  **class** (`GenerationEngine.generate`), not the module attr — the existing
  `_ENGINE` instance picks up class-level method patches via MRO.
- FastAPI VALIDATION_ERROR returns 422 (not 400) per `_errors.py`
  `_ERROR_CODE_STATUS` map. Adjusted lyrics negative-path expectations.
- `httpx` request headers preserve casing (`Authorization` capital A); use a
  case-insensitive lookup when asserting recorded forwarded headers.
- Telemetry-absence assertion must check exact module prefixes
  (`sentry_sdk`, `posthog`, `analytics`, `segment_analytics`, `mixpanel`);
  naive substring `"segment" in mod` false-positives on `rich.segment`.
- No `transcriptions` table in the DB schema (only `Generation`, `Job`,
  `Setting`). Transcription endpoint tests assert response shape only.
- No vault/keyring/telemetry code exists in sidecar yet. Tests assert
  **absence** (`keyring not in sys.modules`, no telemetry-module prefix,
  healthz `test_mode: true`) rather than mock-and-verify-zero-calls.
- TestClient yields to FastAPI background tasks between requests via its
  internal portal; polling `GET /jobs/{id}` in a tight loop without
  `time.sleep()` works for stubbed sub-second jobs (helper `wait_for_job`
  caps at 50 iterations).
- Per-test SQLite tempfile under `tmp_path` proven isolated by
  `test_second_run_does_not_see_prior_test_data` (would fail loudly on leak)
  and `test_sqlite_path_is_under_temp_dir` (no escape to real user data dir).
- OpenRouter stub: stdlib `ThreadingHTTPServer` on `127.0.0.1:0`, ephemeral
  port, JSON fixture from `packages/test-helpers/fixtures/openrouter/`.
  Records forwarded request body + headers for assertion.
- Pyenv local: Python 3.14.0 runs the suite despite `pyproject.toml`
  declaring `requires-python = ">=3.12,<3.13"` — pytest invocation works
  because the constraint is a metadata hint, not a runtime gate.
