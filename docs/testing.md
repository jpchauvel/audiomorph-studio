# Testing

AudioMorph Studio uses a six-layer test pyramid: **component** tests for renderer UI in isolation, **renderer integration** tests for renderer + mocked IPC, **sidecar integration** tests for the FastAPI Python sidecar in process, **visual regression** tests for pixel-stable snapshots, **Electron E2E** tests that launch the real shell + sidecar + engines, and the **CI pipeline** that orchestrates all of them per push and per release. Each layer is fast where it can be and slow only where it must be; the local helper scripts below let you pick the right tier for the change in front of you.

## Test layers

| Layer                                         | Command                         | Runtime budget | CI tier           |
| --------------------------------------------- | ------------------------------- | -------------- | ----------------- |
| Component (renderer in isolation)             | `pnpm test:component`           | < 30 s         | every push        |
| Renderer integration (mocked IPC)             | `pnpm test:integration`         | < 60 s         | every push        |
| Sidecar integration (Python)                  | `pnpm test:sidecar-integration` | < 90 s         | every push        |
| Visual regression (Playwright snapshots)      | `pnpm test:visual`              | < 90 s         | every push        |
| Electron E2E (real shell + sidecar + engines) | `pnpm test:e2e`                 | < 5 min        | nightly + release |
| CI pipeline (full matrix)                     | GitHub Actions                  | < 15 min       | per PR + release  |

## First-time setup

1. Clone the repo and `pnpm install` at the root.
2. Install Python deps for the sidecar: `cd apps/sidecar && python3.12 -m venv .venv && .venv/bin/pip install -e .`.
3. Warm the HuggingFace cache once so model-dependent tests do not redownload weights:
   ```bash
   pnpm test:hf:warm
   pnpm test:hf:verify
   ```
4. Run `pnpm test:fast` to confirm the toolchain is wired.

## Tiered local commands

Aliases composed for convenience. They do **not** bypass any layer; they only let you opt out of slow layers when a change does not need them.

- `pnpm test:fast` — component + sidecar unit (`@audiomorph/sidecar`).
- `pnpm test:mid` — everything in `test:fast` plus renderer integration, sidecar integration, and visual regression.
- `pnpm test:full` — everything in `test:mid` plus Electron E2E.

## Debugging

- **Electron E2E, headed**: `pnpm test:e2e:headed` launches Playwright with `PWDEBUG=1` and `--headed` so you can step through specs with a visible Electron window.
- **Visual snapshot updates**: when a UI change is intentional, regenerate baselines with `pnpm test:visual:update`. Review the resulting PNG diffs in `apps/renderer/tests/visual/__snapshots__/<platform>/` before committing.
- **Stuck sidecar handshake during E2E**: confirm the venv at `apps/sidecar/.venv` exists and `audiomorph-sidecar` is importable; the shell hardcodes `.venv/bin/python` in dev mode.
- **Secret leak suspicion**: run `pnpm scrub-secrets` to scan `.test-results/`, `playwright-report/`, and `test-results/` for accidentally captured tokens.

## What to run before pushing

```
quick fix (typo, copy change, isolated component)
  → pnpm test:fast

feature work (renderer wiring, sidecar handler, visual change)
  → pnpm test:mid

release candidate, refactor across boundaries, or anything touching IPC
  → pnpm test:full
```

If you are unsure which tier applies, run the next one up — local cost is cheaper than a red PR.
