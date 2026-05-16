# Contributing to AudioMorph Studio

Thank you for considering a contribution! This document covers the
workflow, conventions, and expectations for changes to this repository.

---

## Project values (non-negotiable)

These are not stylistic preferences; they are correctness requirements:

1. **Local-first.** No telemetry, no analytics, no auto-update, no
   account system, no cloud sync. The only optional network call is
   user-initiated OpenRouter (lyrics assistance).
2. **BYOK secrets stay out of the renderer.** API keys live in the OS
   keychain (or in-memory test vault under `AUDIOMORPH_TEST_MODE=1`).
   They MUST NEVER be:
   - written to `localStorage`, `sessionStorage`, IndexedDB, cookies,
     or a Zustand `persist` slice;
   - rendered raw after save (mask only);
   - logged or echoed in any error path, including stack traces.
3. **Sidecar auth uses `X-Audiomorph-Token`** — not
   `Authorization: Bearer`. The token is generated at sidecar spawn
   time, transmitted via the first stdout JSON line, and never
   propagated to the renderer.
4. **No hardcoded `http://127.0.0.1:PORT`** in the renderer. Always
   read `window.__AUDIOMORPH_API_BASE__` (set by the preload script).
5. **No raw colors.** All colors flow through OKLCH design tokens; no
   inline hex, rgb, or `style={{ color: '...' }}` in React.
6. **No Google Fonts URL imports.** Use the `geist` npm package only.
7. **`release.yml` is sacrosanct.** Do not modify it without explicit
   discussion. Other CI workflows are open for change.
8. **The `heartlib/` submodule is read-only** in this repo. Upstream
   changes go to its own repository.

Violations of any of the above will be requested-changes on the PR.

---

## Development workflow

```bash
# Fork & clone with submodules
git clone --recurse-submodules <your-fork-url>
cd audiomorph-studio

# Set up tooling (see README.md "Quick start" for details)
pnpm install
cd apps/sidecar && pip install -e ".[dev]" && cd ../..
pre-commit install --install-hooks
pre-commit install --hook-type pre-push

# Branch
git checkout -b feat/<short-slug>     # or fix/, docs/, ci/, refactor/, test/, chore/

# Work in small, atomic commits. Pre-commit will block bad commits.
git add ...
git commit -m "feat(renderer): add waveform zoom control"

# Push (pre-push hook runs the heavier checks)
git push origin feat/<short-slug>

# Open a PR against main
gh pr create --fill
```

---

## Commit conventions

We use **Conventional Commits**:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, `revert`.

Common scopes: `shell`, `renderer`, `sidecar`, `ipc`, `ui`,
`test-helpers`, `ci`, `docs`, `hardware-gate`, `platform`.

Examples:

```
feat(renderer): add OKLCH theme toggle to settings drawer
fix(sidecar): close SQLite session on cancelled SSE stream
ci(cost): cap test-pr concurrency to 1 per ref
docs(readme): document sidecar-only dev workflow
```

Keep the subject line ≤72 characters. Write the body in the
imperative mood (“add”, “fix”, “remove”), not past tense.

---

## Code style

### TypeScript / React (apps/shell, apps/renderer, packages/)

- ESLint config: [`eslint.config.js`](./eslint.config.js).
- Prettier config: [`prettier.config.js`](./prettier.config.js).
  Width 100, single quotes, trailing commas, 2-space indent.
- **Strict TypeScript.** `any`, `as any`, `@ts-ignore`, and
  `@ts-expect-error` are forbidden. If a type genuinely cannot be
  expressed, open an issue first.
- React components: function components, hooks only. No class
  components.
- Imports: relative within a package; workspace alias
  (`@audiomorph/<pkg>`) across packages. Sorted by Prettier.

### Python (apps/sidecar)

- **Ruff** is the single source of truth for lint + format.
  Config: [`apps/sidecar/ruff.toml`](./apps/sidecar/ruff.toml).
  - Line length: **78** (PEP 8 strict).
  - Import sorting: ruff’s `I` rules (isort-compatible).
  - Rule set: `ALL` minus the documented opt-outs (see ruff.toml).
- **Mypy strict mode** on `src/`. Tests are excluded.
  Config in [`apps/sidecar/pyproject.toml`](./apps/sidecar/pyproject.toml).
- **Bandit** for security smells, configured under `[tool.bandit]` in
  `apps/sidecar/pyproject.toml`.
- **`subprocess` calls must never use `shell=True`.** Pass arg arrays.
- **Never log `HF_TOKEN`, the sidecar token, or the OpenRouter key.**

### Tests

- TypeScript: vitest for unit, Playwright for component/integration/E2E/visual.
- Python: pytest with markers `integration` for the slower suite.
- Jest is **not** used. Do not introduce it.
- The JUnit reporter MUST stay enabled — CI parses its output.

---

## Pre-commit and pre-push hooks

This repo uses [`pre-commit`](https://pre-commit.com/) to enforce
quality gates locally. After cloning, install hooks once:

```bash
pre-commit install --install-hooks
pre-commit install --hook-type pre-push
```

The fast (`pre-commit`) stage runs on every `git commit`:

- ruff lint + format (Python)
- eslint (TypeScript, changed files)
- prettier (TypeScript / JSON / Markdown / YAML, changed files)
- gitleaks (secret scan, staged content only)
- editorconfig + trailing-whitespace + EOF-newline

The heavier (`pre-push`) stage runs on every `git push`:

- mypy strict (Python)
- bandit (Python security)
- gitleaks full scan
- `pnpm typecheck`
- `pnpm test:fast`

Bypassing hooks (`--no-verify`) is reserved for emergencies and must
be called out explicitly in the PR.

---

## Pull request checklist

Before requesting review:

- [ ] Branch is rebased on latest `main`.
- [ ] Commits follow Conventional Commits.
- [ ] `pre-commit run --all-files` passes.
- [ ] `pnpm test:fast` passes locally.
- [ ] If you touched the renderer: visual tests still pass, or the
      baseline update was triggered via the
      `update-visual-baselines.yml` workflow (not by hand).
- [ ] If you touched the sidecar: `pnpm test:py` passes, and you
      ran `bandit -c pyproject.toml -r src` cleanly.
- [ ] No new dependencies without a one-line rationale in the PR body.
- [ ] No changes to `.github/workflows/release.yml` unless the PR is
      explicitly about the release pipeline (and reviewed twice).
- [ ] No secrets, keys, or personal paths in the diff.
- [ ] PR description states **what**, **why**, and **how to verify**.

---

## Reporting bugs

Open a GitHub issue with:

- AudioMorph Studio version (or commit SHA).
- OS + architecture (`uname -a` / Windows version + CPU).
- Node / Python versions (`node -v`, `python --version`).
- Steps to reproduce.
- Expected vs actual behavior.
- Relevant logs **with secrets redacted**. Use
  `pnpm scrub-secrets` to clean an output bundle before attaching.

---

## Reporting security issues

Do **not** open a public issue. Use GitHub Security Advisories on
this repository. We will respond within a reasonable timeframe and
coordinate a fix and disclosure.

---

## License

By contributing, you agree that your contributions will be licensed
under the [MIT License](./LICENSE).
