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
- NEVER hardcode http://127.0.0.1:PORT — read from window.**AUDIOMORPH_API_BASE**
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
  4. `apps/shell/src/preload.ts` (line 135–137) — expose **AUDIOMORPH_TEST_MODE** to renderer window
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

## T12 — Visual regression suite

- `node:fs` does **not** export `globSync` in this runtime (Node 22 ESM). Use
  static route lists in spec files or `fast-glob` if dynamic discovery needed.
  Auto-discovery sounded elegant but adding a route to a 6-entry ROUTES const
  is a trivial maintenance cost.
- Sentinel pattern `<span hidden data-testid="route-ready" />` placed as first
  child of each page wrapper avoids colliding with existing testids
  (`lyrics-workspace`, `first-run-wizard`). Always-rendered so no async wait
  on data fetches — eliminates flake without `waitForTimeout`.
- `data-theme` attribute on `<html>` is set via `page.evaluate` per-test. Note
  current `globals.css` only defines dark tokens — `light` snapshots are
  identical to `dark` snapshots in practice. The matrix still locks in current
  behavior so when light-mode tokens land, the diff will be obvious.
- Per-platform baselines via `snapshotPathTemplate: '{testDir}/__snapshots__/
{platform}/{testFilePath}/{arg}{ext}'`. macOS-only baselines committed;
  linux/win32 generated on those runners in CI.
- OKLCH-flip regression proof: changing `--color-primary` from
  `oklch(65% 0.22 250)` to `oklch(80% 0.22 30)` triggered 4/12 failures
  (lyrics + first-run, both themes). Confirms `maxDiffPixelRatio: 0.01`
  catches realistic color regressions.
- Playwright `webServer` with `bun x serve@latest out -l 3000` correctly
  serves Next.js static export — but requires fresh `pnpm --filter renderer
build` after any source change. Regression detection workflow: edit → build
  → test → revert → build → test.

## T13 — Component CI guard

- `_guard.spec.ts` consolidates 3 invariant assertions into ONE test to keep
  the total count at 25 + 1 = 26 (matching the spec's expected outcome).
  Splitting assertions across multiple `test()` blocks would inflate the count.
- Guard invariants:
  1. `process.env.AUDIOMORPH_TEST_MODE` ∈ {undefined, '1'} — catches CI typos
     like `'wrong'`, `'true'`, `'false'` that would silently bypass test-mode
     branching in production code.
  2. `window.__AUDIOMORPH_IPC__` probe via `page.evaluate` returns without
     throwing — catches breakage of the IPC injection contract.
  3. `window.__AUDIOMORPH_INTEGRATION_SETUP__` is undefined — catches
     accidental leak of integration-config `_setup.ts` into component runs.
- Bad-env proof: `AUDIOMORPH_TEST_MODE=wrong pnpm exec playwright test ...
_guard.spec.ts` → 1 failed with clear assertion message including the bad
  value. The `expect(..., message).toBe(true)` pattern produces actionable
  failure output.
- Component suite under split config: 26 passed in 6.8s — well under the
  2-minute runtime budget.

## T14 — Electron E2E suite (2026-05-16)

- Playwright `_electron.launch` works against `apps/shell/dist/main.js` once `AUDIOMORPH_TEST_MODE=1` is set; helper already exists in `packages/test-helpers/src/electron.ts`.
- **Subpath-exports trap**: `packages/hardware-gate` ESM with extensionless imports failed under Electron 33 CJS main; fixed by (a) adding `.js` extensions in source `index.ts` and (b) overriding `tsconfig.json` to emit `module:CommonJS` + `moduleResolution:node` (commits a36e943, 40957ef).
- **Scoped ESM**: introduced `apps/shell/tests/e2e/package.json` `{"type":"module"}` so the e2e specs can use ESM `import` without forcing the whole `apps/shell` package to ESM (which would break the CJS-emitting shell build).
- **Test-mode hardware bypass**: `apps/shell/src/hardware/hardware-check.ts` now early-returns when `AUDIOMORPH_TEST_MODE=1` with marker `// AUDIOMORPH_TEST_MODE hook` (commit 960e241). Production builds must never set this env var.
- **Sidecar bootstrap gap**: `apps/shell/src/main.ts` never calls `SidecarManager.getInstance({...}).start()` before `registerIpcBridge()`, so a real sidecar is never spawned. Inserting that call also requires a Python 3.12 venv with `audiomorph-sidecar` deps (`apps/sidecar/pyproject.toml`) — out of scope for the e2e scaffolding task.
- **All 6 specs are `test.fixme()`** until the sidecar runtime prerequisite is met. JUnit emission, Playwright collection, and the `_setup.ts` helper are all exercised, so the suite is wired up and ready for un-fixme once the runtime lands.

## T15: Scrubber CI integration script

- `scripts/scrub-test-output.mjs` is standalone (no import from `packages/test-helpers/src/scrubber.ts`) per spec constraint "do NOT modify scrubber.ts". Patterns duplicated with tighter regex per T15 spec (e.g., `sk-or-v1-` prefix required, not just `sk-or-`).
- Node 18+ `fs.promises.readdir({recursive:true, withFileTypes:true})` returns Dirent entries; use `entry.parentPath ?? entry.path` for compat across Node 18/20+.
- ENOENT on missing scan dirs returns `[]` rather than failing — many repos lack `.test-results/`, `playwright-report/` etc.
- Whitelist semantics: skip match if matched substring **contains** literal `PLANTED-FAKE-TEST-TOKEN` (substring check on the regex hit, not the line).
- Binary file extensions (`.png .mp4 .wav .jpg .gif`) — filename-only check (do not read content).
- Pre-existing local evidence (`.sisyphus/evidence/task-3-scrub-planted-secrets.txt`) contains a real-shaped fake JWT on line 11 that the script correctly detects. `.sisyphus/evidence/` is gitignored so this varies per machine. For QA scenario 2 (whitelist-ok), temporarily moved that file aside to validate isolated whitelist behavior — confirmed exit-code=0.
- Positive-control test uses `execFileSync('node', [scriptPath])` and copies a planted token into `.test-results/_positive_control_qa/leak.txt` then cleans up. Asserts exit=1 + `OPENROUTER_KEY` in stdout.
- 47/47 tests pass in `@audiomorph/test-helpers` (23 in scrubber.test.ts including new positive-control).

## T15 follow-up: exclude .sisyphus from scan

- Removed `.sisyphus/evidence` from `SCAN_DIRS`. Internal tooling dirs (notepads/evidence/plans) intentionally contain real-shaped fake tokens as documentation; scanning them yields false positives.
- Final scan dirs: `.test-results`, `playwright-report`, `test-results` only.
- Verified: clean exit 0, detection exit 1.

## T16: Visual diff PR comment bot

- `scripts/post-visual-diff-comment.mjs`: walks `apps/renderer/tests/visual/__snapshots__/<platform>/test-results/` for `*-diff.png`.
- Idempotency via marker `<!-- audiomorph-visual-bot -->` in comment body; uses `gh api --paginate` to find existing then PATCH or POST.
- CI mode requires `GITHUB_TOKEN`, `GITHUB_PR_NUMBER`, `GITHUB_REPOSITORY` all set. Local mode prints summary, exit 0.
- API errors are swallowed (`console.warn` + exit 0) — never break CI on bot failures.
- Created `win32/.gitkeep` and `linux/.gitkeep` under `__snapshots__/` so per-platform baseline dirs exist before first run; `darwin/` already populated.
- Filename convention assumed: `<route>-<theme>-diff.png` (split on last dash for theme).

## T17: Tiered local commands + docs/testing.md

- Existing `test:visual:update` already present at line 20 (different `cd apps/renderer` form vs spec's `--config=apps/renderer/...` form). Per "Do NOT modify existing scripts" constraint, kept existing definition and did not re-add. Spec verification still passes (`p.scripts['test:visual:update']` truthy).
- Added 6 new scripts: `test:fast`, `test:mid`, `test:full`, `test:e2e:headed`, `test:hf:warm`, `test:hf:verify`.
- `docs/testing.md` covers six layers (component / renderer-integration / sidecar-integration / visual / e2e / CI), runtime budgets, first-time setup, debugging tips, and a decision tree for which tier to run before push.

## T18: HF cache key + verify scripts

- Model manifest at `apps/sidecar/scripts/required-models.json` (JSON array of `{id, revision, size_mb}`), 2 entries: `facebook/musicgen-small`, `openai/whisper-tiny`.
- Cache key script re-serializes manifest with sorted top-level keys before hashing for whitespace-stability; outputs `hf-models-v1-<sha256[:16]>` (e.g. `hf-models-v1-d827049039f82a8b`).
- Verify script checks `${HF_HOME:-~/.cache/huggingface}/hub/models--<org>--<name>/snapshots/<revision>` per entry; missing snapshots → exit 1 with per-model paths + hint to run `pnpm test:hf:warm`. Confirmed exit 1 on this machine (models not cached) — clean message, no stack trace.
- NOTE: existing `packages/test-helpers/src/hf-cache.ts` `loadManifest()` uses `resolve(join(homedir(), '..', 'apps', 'sidecar', ...))` which is broken (homedir/.. is /Users on macOS, not repo root). Did not fix (T18 forbids modifying source). New scripts compute repo root from script location instead.
- Both scripts pure ESM, no deps, exit codes: 0 ok / 1 missing-or-bad-input / 2 unexpected.

## T19: Smoke real-engines validator

- Script flow: (1) reuse cache-check from T18 (inlined, not imported — keeps scripts self-contained); (2) spawn `python3 -m audiomorph.main --port 0 --token <TEST_TOKEN>` in `apps/sidecar/` with `AUDIOMORPH_TEST_MODE=1`; (3) parse stdout line-by-line for `{event:"listening",port,token}` (30s timeout); (4) POST `/health` with `X-Audiomorph-Token` header (10s AbortController); (5) 200 → exit 0, else exit 1; sidecar SIGTERM on every exit path.
- GOTCHA: `import * as process from "node:process"` returns the namespace object — does NOT expose EventEmitter methods like `process.on()`. Use `import process from "node:process"` (default import) when you need `.on()`. Caught at first run (TypeError on line 45). T18 scripts only touch `process.env/exit/stdout` so namespace import works there.
- Verified: exits 1 with clean missing-models message on this machine (no stack trace, no sidecar spawn attempted).
- Did NOT use `shell:true`; uses `spawn(python, [...args])` array form.

## T20: PR-tier CI workflow

- `.github/workflows/test-pr.yml`: ubuntu-latest only, 15min budget, PR trigger only (no push), concurrency-grouped on head_ref with cancel-in-progress.
- Steps: checkout → node 22 (pnpm cache) → python 3.12 → install deps → typecheck → lint → component → sidecar unit (`pnpm --filter @audiomorph/sidecar test`) → integration → sidecar-integration → scrub-secrets → upload .test-results xml (always) → upload playwright-report (on failure).
- All 5 `uses:` pinned to 40-char SHAs per spec (checkout/setup-node/setup-python/upload-artifact×2). Kept `# v4`/`# v5` trailing comments as human-readable version markers per GitHub security-hardening convention.
- actionlint clean (exit 0). release.yml byte-identical (diff = 0 lines).
- No HF model download, no E2E/visual, no continue-on-error.

## T21: Main-tier CI workflow

- `.github/workflows/test-main.yml`: push-to-main only, 2 jobs.
  - `main-full-linux` (30min): mirrors test-pr.yml steps + `test:visual`, `scrub-secrets`, `post-visual-diff-comment.mjs`, plus 3 artifact uploads (test-results-main 14d, visual-baselines-linux 14d, playwright-report on failure 7d).
  - `main-deps-audit` (5min): `pnpm audit --audit-level=high` + `pip-audit -r apps/sidecar/requirements.txt`. No continue-on-error.
- `concurrency: cancel-in-progress: false` on main (don't drop in-flight builds for newer pushes — each main commit must be verified).
- No `--update-snapshots` (visual baselines updated via local `test:visual:update`, never CI).
- All 9 `uses:` lines pinned to 40-char SHAs; actionlint exit 0; release.yml + test-pr.yml diff = 0 lines.

## T22: Nightly 3-platform CI workflow

- `.github/workflows/test-nightly.yml`: cron `0 7 * * *` + workflow_dispatch, no push trigger.
- Matrix: ubuntu-latest, macos-14, windows-latest. `fail-fast: false` so a flaky OS doesn't abort others.
- Fork guard: `if: github.event_name == 'workflow_dispatch' || github.repository_owner == 'OWNER'` (placeholder OWNER — orchestrator to replace).
- HF cache key uses `hashFiles('apps/sidecar/scripts/required-models.json')` — the actual manifest path (NOT spec's `packages/test-helpers/src/hf-manifest.json` which doesn't exist). Spec deviation noted.
- Canary order enforced: `smoke-real-engines.mjs` at step 79 runs BEFORE `test:e2e` at step 82. Cheap real-engine smoke fails fast before expensive Electron E2E.
- `permissions: issues: write` required for failure-issue-creation step via `actions/github-script@v7`.
- All 6 unique actions SHA-pinned (checkout, setup-node, setup-python, cache, upload-artifact, github-script).
- `concurrency: cancel-in-progress: false` on `nightly-${{ github.run_id }}` — each run is unique so this is mostly defensive.

## T23: Manual visual-baseline update workflow

- `.github/workflows/update-visual-baselines.yml`: workflow_dispatch only (no schedule/push/pull_request).
- 3 required inputs: `platforms` (choice: linux/macos/windows/all), `branch` (optional), `reason` (required string for audit trail).
- `permissions: contents: write` required for git push back to the branch.
- **actionlint gotcha**: `matrix.*` context is NOT available in job-level `if:`. Spec's combined condition `if: (actor-check) && (platforms == matrix.platform)` fails with: `context "matrix" is not allowed here. available contexts are "github", "inputs", "needs", "vars"`. Fix: keep actor gate at job level, push platform-filter to per-step `if:` (where matrix.\* IS valid).
- Actor gate: `github.actor == github.repository_owner || contains(fromJSON('["MAINTAINER_USER"]'), github.actor)` (placeholder MAINTAINER_USER).
- Empty-commit guard: `git diff --cached --quiet || git commit ...` — exits cleanly if no baseline diffs.
- HF cache **verify only** (no warm) — baseline updates assume nightly already warmed the cache.
- Per-platform snapshot dirs: linux/darwin/win32 (matches Playwright's `process.platform` naming).
- 4 actions SHA-pinned (checkout, setup-node, setup-python, cache).

## T24: CI cost-guards audit

Audited all 4 workflows; only `test-pr.yml` needed editing.

### Per-workflow guard matrix (verified):

| Workflow                    | Permissions                        | Concurrency cancel | Other guards                          |
| --------------------------- | ---------------------------------- | ------------------ | ------------------------------------- |
| test-pr.yml                 | contents:read, pull-requests:write | true               | + paths-ignore (added in T24)         |
| test-main.yml               | contents:read                      | false              | (T21)                                 |
| test-nightly.yml            | contents:read, issues:write        | false              | fork guard + fail-fast:false (T22)    |
| update-visual-baselines.yml | contents:write                     | false              | actor gate + empty-commit guard (T23) |

### T24 change: paths-ignore on test-pr.yml

Skips PR-tier CI for docs-only changes (markdown, docs/, ISSUE_TEMPLATE, LICENSE). Saves ~5min/PR on doc-only changes, which are frequent.

### Key insight

T20-T23 already baked in most cost guards correctly. T24 was mostly an audit confirming this + one missing path filter. Designing guards into each workflow at creation time (vs. retrofitting) means audits are cheap.

### release.yml diff = 0 lines (byte-identical, never touched).
