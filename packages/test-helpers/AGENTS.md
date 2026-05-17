# packages/test-helpers

Bridges JS test layers to the Python sidecar. Provides deterministic spawn, HF cache helpers, secret scrubber, test-mode sentinel.

Root context: `/AGENTS.md`.

## Exports

| Subpath       | Purpose                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `./sidecar`   | `spawnSidecar(opts)` — spawns Python with test env; reads handshake from stdout. |
| `./test-mode` | `AUDIOMORPH_TEST_MODE=1` sentinel + `TEST_TOKEN` + `getTestEnv()`.               |
| `./hf-cache`  | HF cache path resolution + manifest verification.                                |
| `./scrubber`  | Regex scrubbers for `X-Audiomorph-Token`, `Bearer sk-or-*`, `dev-local-token`.   |
| `./electron`  | Electron test helpers.                                                           |
| `./fixtures`  | Path to fixture root (audio, openrouter stub responses).                         |

## Key Constants

- `TEST_TOKEN = "test-token-deterministic-do-not-use-in-prod"` — deterministic test token; mirrored by sidecar `conftest.py`.
- Test-mode spawn hooks: `AUDIOMORPH_TEST_NO_HANDSHAKE=1`, `AUDIOMORPH_TEST_TOKEN_OVERRIDE`, `AUDIOMORPH_TEST_SPAWN_CMD`, `AUDIOMORPH_TEST_SPAWN_BIN`.

## HF Cache

- Default location: `HF_HOME` or `~/.cache/huggingface`.
- Manifest: `apps/sidecar/scripts/required-models.json` (override via `AUDIOMORPH_MANIFEST_PATH`).
- Warm: `pnpm test:hf:warm` (downloads MusicGen-small + Whisper-tiny).
- Verify: `pnpm test:hf:verify` (exit 0 if present, 1 if missing).

## Scrubber

Used by `scripts/scrub-test-output.mjs` on `.test-results/` and `playwright-report/`. CI runs `pnpm scrub-secrets` before uploading artifacts. Extend patterns here when adding new secret formats.

## Must Not

- NEVER use `TEST_TOKEN` outside test code.
- NEVER weaken scrubber patterns — they protect CI artifacts from secret leaks.
- NEVER spawn sidecar directly with `child_process.spawn` from tests; use `spawnSidecar()` so handshake + test env stay consistent.
