# AudioMorph Studio — Agent Guide

Local-first Electron + Next.js 16 + FastAPI (Python 3.12) desktop app. BYOK, no telemetry, no auto-update, no cloud.

## Layout

```
apps/shell/      Electron main (TS) — spawns sidecar, IPC bridge, hardware gate
apps/renderer/   Next.js 16 renderer (React) — UI only; talks to main via electronAPI
apps/sidecar/    FastAPI ML server (Python) — NOT in pnpm workspace; venv-managed
packages/        @audiomorph/* — ipc-contracts, hardware-gate, platform, shared-types, test-helpers, ui
heartlib/        Read-only git submodule (ML weights helper). Upstream changes go to its own repo.
docs/            Authoritative protocol/architecture docs — read before changing contracts.
scripts/         Release wrappers, CI HF cache, version stamp, secret scrubber.
```

## Three-Process Boot

1. Electron `main.ts` → `SidecarManager` spawns `python -m audiomorph --port 0 --parent-pid <pid> --auth-token <hex> --handshake-file <tmp>` (or `--handshake-fd` on Unix).
2. Sidecar pre-binds socket, writes `{port, token, pid}` handshake (first stdout line OR fd/file), starts Uvicorn on pre-bound fd.
3. Main reads handshake, exposes `window.__AUDIOMORPH_API_BASE__` via preload. Renderer calls main via `window.electronAPI.*` → main forwards to sidecar with `X-Audiomorph-Token` header.
4. Sidecar watchdog exits when parent PID dies (POSIX `getppid`, Windows `psutil`).

Authoritative: `docs/sidecar-protocol.md`, `apps/shell/src/sidecar/manager.ts`, `apps/sidecar/src/audiomorph/__main__.py`.

## Build Order (matters)

`apps/shell` build depends on built artifacts of `@audiomorph/ipc-contracts` + `@audiomorph/hardware-gate`. Shell's `build:shell` script enforces this. Breaking imports during local builds usually means dependent packages weren't built first.

## Cross-Language Codegen

`packages/shared-types/src/python_gen.ts` generates Python types consumed by sidecar (`apps/sidecar/src/audiomorph/schemas.py` — DO NOT EDIT MANUALLY). Run `pnpm --filter @audiomorph/shared-types gen:python` after changing shared types.

## Pinned Versions (CI-enforced)

Node 22.x (`.nvmrc`) • pnpm 9.15.0 (`packageManager`) • Python 3.12 (`.tool-versions`). Heartlib pinned to 3.12 — DO NOT use 3.14 until wheel matrix resolved (`docs/wheel-matrix-verification.md`).

## Commands

```bash
pnpm dev                  # shell + renderer; sidecar lazy
pnpm build:all            # production build
pnpm test:fast            # component + Python unit
pnpm test:mid             # + integration + sidecar-integration + visual
pnpm test:full            # + Electron E2E (requires HF cache)
pnpm test:hf:warm         # download MusicGen-small + Whisper-tiny
pnpm dist:{mac,win,linux} # electron-builder per OS
pnpm typecheck            # workspace TS only (sidecar uses mypy separately)
```

## CI Tiers

- `test-pr.yml` — PR smoke (ubuntu, no HF, no E2E).
- `test-main.yml` — push to main; visual regression + baseline upload.
- `test-nightly.yml` — matrix (linux/mac/win), HF cache restore/warm, full E2E.
- `release.yml` — on `v*` tag; per-OS build → draft release + SHA256SUMS. **SACROSANCT** — do not modify without explicit approval.
- `update-visual-baselines.yml` — manual dispatch only; bot commits snapshots. Visual baselines are CI-managed; do NOT update locally for PRs.

See `docs/ci-cost-guards.md`.

## ANTI-PATTERNS (BLOCKING)

**Secrets / auth**:

- NEVER persist BYOK keys to localStorage/sessionStorage/IndexedDB/cookies/Zustand-persist. OS keychain only (in-memory vault when `AUDIOMORPH_TEST_MODE=1`).
- NEVER render raw secrets after save (mask only).
- NEVER log HF_TOKEN, sidecar token, or OpenRouter key. Stack traces stay out of error `message`; sensitive context only in server-only `details`.
- ALWAYS use `X-Audiomorph-Token` header for sidecar auth. NEVER `Authorization: Bearer`.
- NEVER propagate sidecar token to the renderer.
- NEVER hardcode `http://127.0.0.1:PORT` in renderer. Read `window.__AUDIOMORPH_API_BASE__`.

**Types / style**:

- FORBIDDEN: `any`, `as any`, `@ts-ignore`, `@ts-expect-error`.
- React function components + hooks only. No class components.
- Python: NEVER `subprocess(..., shell=True)`. Pass arg arrays.
- No raw colors — use OKLCH design tokens.
- No Google Fonts URL imports — use `geist` npm package.
- No Jest. Vitest + Playwright + pytest only.

**Repo**:

- `heartlib/` is read-only here. Upstream changes go to the heartlib repo.
- Generated files (`packages/shared-types/src/python_gen.ts` output, `apps/sidecar/src/audiomorph/schemas.py`) — regenerate, never hand-edit.
- No new deps without one-line rationale in PR body.
- `.github/workflows/release.yml` — sacrosanct.

## Conventions

- ESLint: `no-explicit-any` is **warn** (tech debt), `_`-prefix ignores unused-vars, `no-console` warn.
- Prettier: `printWidth: 100`, `trailingComma: 'all'`, `singleQuote: true`.
- tsconfig.base: strict + `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, emits declarations.
- Python (`apps/sidecar/pyproject.toml`): mypy strict; ruff line-length 78, target py312; bandit skips B101/B105/B107 (test-only).
- No global `@audiomorph/*` tsconfig path aliases — pnpm workspace linking only. Renderer has local `@/* → ./*` alias.
- Pre-commit (fast): trailing whitespace, EOF, yaml/toml/json, gitleaks, ruff, prettier, eslint.
- Pre-push: typecheck, mypy (strict), bandit, `test:fast`. `--no-verify` is emergency-only; call it out in PR.

## Where to Look When…

- **Sidecar won't start** → `apps/shell/src/sidecar/manager.ts` + `userData/logs/sidecar-*.log` (tokens masked) + handshake file in `os.tmpdir()`.
- **IPC fails** → `apps/shell/src/ipc/bridge.ts` (api:request, api:stream handlers) + `apps/shell/src/preload.ts` (electronAPI surface).
- **Renderer can't reach sidecar in tests** → `apps/renderer/tests/integration/_setup.ts` `installRendererBootstrap()` must run.
- **Hardware gate false-positive** → `packages/hardware-gate/src/detect.ts` (Apple Silicon unified-memory mapping lives there).
- **HF cache missing** → `scripts/ci-hf-cache-verify.mjs` + `pnpm test:hf:warm`.

## Subdir Guides

`apps/shell/AGENTS.md` • `apps/renderer/AGENTS.md` • `apps/sidecar/AGENTS.md` • `packages/shared-types/AGENTS.md` • `packages/test-helpers/AGENTS.md`
