# AudioMorph Studio

Cross-platform desktop application for local audio morphing, synthesis, and
lyric assistance. Built as an Electron shell over a Next.js renderer with a
FastAPI Python sidecar for ML inference (MusicGen, Whisper).

**Local-first. BYOK. No accounts. No telemetry. No auto-update. No cloud.**

The only optional network call is to OpenRouter (lyrics assistance), gated
behind a user-provided API key that is never persisted to disk.

---

## Architecture

```
audiomorph-studio/
├── apps/
│   ├── shell/        # Electron main process (TypeScript)
│   ├── renderer/     # Next.js 15 renderer (React, OKLCH design tokens)
│   └── sidecar/      # FastAPI Python ML server (port-0 spawn, X-Audiomorph-Token)
├── packages/
│   ├── ipc-contracts/    # Shared IPC types (shell ↔ renderer)
│   ├── hardware-gate/    # Pre-launch hardware capability check
│   ├── platform/         # OS-specific utilities
│   ├── shared-types/     # Cross-package type definitions
│   ├── ui/               # Shared React components
│   └── test-helpers/     # Sidecar spawn, scrubber, HF cache, test-mode utils
├── heartlib/         # Read-only git submodule (vendored ML weights helper)
└── docs/             # Architecture, testing, CI, release docs
```

Six-layer testing pyramid: component → renderer integration → sidecar pytest
integration → Electron E2E → visual regression → CI pipeline. See
[`docs/testing.md`](./docs/testing.md).

---

## Prerequisites

| Tool        | Version  | Notes                                  |
| ----------- | -------- | -------------------------------------- |
| Node.js     | 22.x     | Pinned via `.nvmrc`                    |
| pnpm        | 9.15.0   | Pinned via `packageManager` field      |
| Python      | 3.12.x   | Pinned via `.tool-versions`            |
| uv (or pip) | latest   | For sidecar dependency install         |
| Git LFS     | optional | Only if working with vendored fixtures |

macOS/Linux setup with [mise](https://mise.jdx.dev/) or
[asdf](https://asdf-vm.com/) will pick up `.tool-versions` automatically.

Optional system tools (used by pre-commit + CI):

```bash
brew install gitleaks pre-commit          # macOS
sudo apt install gitleaks pre-commit      # Debian/Ubuntu
```

---

## Quick start: development environment

```bash
# 1. Clone with submodules
git clone --recurse-submodules https://github.com/jpchauvel/audiomorph-studio.git
cd audiomorph-studio

# 2. Install JS dependencies (monorepo)
pnpm install

# 3. Install Python sidecar dependencies (editable install)
cd apps/sidecar
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cd ../..

# 4. Install git hooks (pre-commit + pre-push)
pre-commit install --install-hooks
pre-commit install --hook-type pre-push

# 5. Run the full dev environment
#    - boots Electron shell (main process)
#    - boots Next.js renderer with HMR
#    - sidecar is auto-spawned by the shell on demand
pnpm dev
```

The Electron window will open once the shell builds and the renderer
compiles. The sidecar is launched lazily by the shell as
`python -m audiomorph --port 0 --parent-pid <shell-pid> --auth-token <generated> --handshake-file <tmp>`.
The shell reads `{"port": N, "token": "...", "pid": N}` from the handshake
file once the FastAPI server is bound, then exposes the API base URL to
the renderer as `window.__AUDIOMORPH_API_BASE__`. The sidecar self-exits
when its parent shell dies (POSIX `getppid`) or the parent pipe closes
(Windows).

### Useful dev commands

```bash
pnpm dev                 # full dev (shell + renderer; sidecar lazy)
pnpm build:all           # production build of shell + renderer
pnpm start               # run a previously-built Electron app
pnpm dist:mac            # build a .dmg / .zip via electron-builder
pnpm dist:win            # build NSIS installer
pnpm dist:linux          # build AppImage / deb
```

### Sidecar-only dev (no Electron)

```bash
cd apps/sidecar
source .venv/bin/activate
python -m audiomorph \
  --port 8001 \
  --parent-pid $$ \
  --auth-token dev-local-token \
  --handshake-file /tmp/audiomorph-dev-handshake.json

# In another shell:
curl http://127.0.0.1:8001/healthz                      # auth-exempt liveness
curl -H "X-Audiomorph-Token: dev-local-token" \
  http://127.0.0.1:8001/models                          # authenticated route
```

`--parent-pid` is required: the sidecar watchdog exits when this PID is no
longer its parent (use `$$` to bind to the current shell). `--handshake-file`
receives `{"port": N, "token": "...", "pid": N}` as soon as the server is
bound — useful for integration scripts. Alternatively, pass `--handshake-fd <n>`
to write the same payload to an inherited file descriptor (used by the
Electron shell in production).

---

## Testing

```bash
pnpm test                       # vitest (TS) + pytest (Python) – fast
pnpm test:fast                  # component tests + sidecar unit tests
pnpm test:mid                   # + integration, sidecar-integration, visual
pnpm test:full                  # + Electron E2E (slow; requires built shell)

# Individual layers
pnpm test:component             # Playwright component tests (no sidecar)
pnpm test:integration           # Playwright + real spawned sidecar
pnpm test:sidecar-integration   # pytest with real SQLite tempfiles
pnpm test:e2e                   # Electron + real sidecar + real engines
pnpm test:visual                # visual regression (per-OS baselines)

# Visual baselines (CI-managed; do NOT update locally for PRs)
pnpm test:visual:update         # only run locally for triage
```

The HuggingFace model cache is required for real-engine E2E. Warm it once:

```bash
pnpm test:hf:warm               # downloads MusicGen-small + Whisper-tiny
pnpm test:hf:verify             # exit 0 if cache present, 1 if missing
```

See [`docs/testing.md`](./docs/testing.md) for the full testing layer guide
and [`docs/ci-cost-guards.md`](./docs/ci-cost-guards.md) for CI tiering.

---

## Code quality

| Layer      | Lint   | Format   | Types | Security         |
| ---------- | ------ | -------- | ----- | ---------------- |
| TypeScript | eslint | prettier | tsc   | gitleaks         |
| Python     | ruff   | ruff fmt | mypy  | bandit, gitleaks |

```bash
# TypeScript
pnpm lint
pnpm format
pnpm typecheck

# Python (from apps/sidecar/)
ruff check .
ruff format .
mypy src
bandit -c pyproject.toml -r src

# Secret scanning (whole repo)
gitleaks detect --no-banner --redact
```

All of the above run automatically on `git commit` (fast subset) and
`git push` (full subset) via [`pre-commit`](./.pre-commit-config.yaml).

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for workflow, commit conventions,
PR checklist, and project values.

---

## Security

- **API keys** are stored in OS keychain only (never localStorage,
  sessionStorage, or Zustand-persisted state). They are masked in every
  rendered view after save.
- **Sidecar auth** uses a per-run token via the `X-Audiomorph-Token`
  header (never `Authorization: Bearer`). The token is generated at
  spawn time and only known by the parent shell.
- **No telemetry, no analytics, no auto-update.** Network egress is
  limited to: (a) the user's OpenRouter calls if they choose to enable
  lyric assistance, and (b) HuggingFace model downloads (one-time, opt-in).
- Report vulnerabilities privately via GitHub Security Advisories.

---

## License

MIT — see [LICENSE](./LICENSE).
