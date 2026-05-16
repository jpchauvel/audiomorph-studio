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
