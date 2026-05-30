# apps/sidecar — FastAPI ML Sidecar

Python 3.12 FastAPI server for MusicGen / Whisper / lyric inference. **NOT** in pnpm workspace — uv/pip + venv managed separately.

Root context: `/AGENTS.md`. Protocol: `docs/sidecar-protocol.md`.

## Setup

```bash
cd apps/sidecar
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# REQUIRED for generation/transcription. Pulls torch + torchaudio +
# transformers + accelerate + bitsandbytes (~multi-GB, 5-15 min).
# Without this, _pick_device() raises ModuleNotFoundError: No module
# named 'torch' and POST /jobs/generate fails with INTERNAL_ERROR.
pip install -e ../../heartlib
```

## Run Standalone

```bash
python -m audiomorph \
  --port 0 \
  --host 127.0.0.1 \
  --parent-pid $$ \
  --auth-token dev-local-token \
  --handshake-file /tmp/audiomorph-handshake.json
```

Required args: `--parent-pid` (watchdog exits when this PID dies), `--auth-token`. Handshake target: `--handshake-fd <n>` (Unix, used by Electron) OR `--handshake-file <path>`.

## Critical Files

- `src/audiomorph/__main__.py` — Arg parsing, pre-bind socket on `--port` (0 = ephemeral), write handshake `{port, token, pid}`, start Uvicorn on pre-bound fd, launch watchdog.
- `src/audiomorph/app.py` — `create_app(auth_token)`: FastAPI + CORS (localhost) + `AuthMiddleware` + routers (models, jobs, lyrics, export, settings, openrouter).
- `src/audiomorph/_auth.py` — `X-Audiomorph-Token` constant-time compare. `/healthz` exempt.
- `src/audiomorph/_watchdog.py` — Parent-PID polling thread; sets `server.should_exit`.
- `src/audiomorph/schemas.py` — **GENERATED from `packages/shared-types`**. DO NOT EDIT. Regenerate via `pnpm --filter @audiomorph/shared-types gen:python`.
- `src/audiomorph/routers/` — Route modules. Add new endpoints here.
- `scripts/required-models.json` — HF model manifest. Drives CI cache key + `scripts/ci-hf-cache-verify.mjs`.

## Tests

```bash
pnpm test:py                  # all pytest (unit + integration)
pnpm test:sidecar-integration # tests/integration/ only
```

`tests/integration/conftest.py` autouse-sets `AUDIOMORPH_TEST_MODE=1`, provides fixtures: `auth_headers`, `sqlite_db` (tmp DB), `app_client` (FastAPI TestClient), `openrouter_stub`, `stub_musicgen`, `stub_whisper`. Test token: `test-token-deterministic-do-not-use-in-prod`. Fixtures dir: `packages/test-helpers/fixtures`.

## Tooling

- `mypy` strict; ML libs (torch, transformers, numpy, librosa, huggingface_hub) → `ignore_missing_imports`.
- `ruff` line-length 78, target py312, selects ALL with curated ignores. isort first-party: `audiomorph`.
- `bandit` skips B101 (assert), B105 (hardcoded password test), B107.
- Pre-push runs mypy + bandit + ruff. They block push.

## Must Not

- NEVER use `subprocess(..., shell=True)`. Pass arg arrays.
- NEVER log `auth_token`, `X-Audiomorph-Token` values, or OpenRouter `sk-or-*` keys.
- NEVER edit `schemas.py` by hand.
- NEVER include stack traces in error `message` field — server-only `details` per `docs/error-envelope.md`.
- NEVER import `keyring` when `AUDIOMORPH_TEST_MODE=1` (test asserts this — `tests/integration/test_telemetry_disabled.py`).
- NEVER import telemetry libs (sentry_sdk, posthog, analytics, segment, mixpanel). Test enforces.
- DO NOT upgrade to Python 3.14 — heartlib blockers; pin to 3.12 (`docs/wheel-matrix-verification.md`).
