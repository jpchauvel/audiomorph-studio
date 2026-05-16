# Audiomorph Studio — Integration & E2E Testing Infrastructure

## TL;DR

> **Quick Summary**: Add six layers of testing on top of the already-shipped audiomorph-studio project: (1) reclassify existing 25 mocked Playwright tests as component tests, (2) renderer integration tests hitting real sidecar, (3) sidecar pytest integration tests with real SQLite, (4) Electron desktop E2E with real engines and cached HF models, (5) cross-platform visual regression, (6) tiered CI pipeline (PR-smoke / Main-integration / Nightly-full-matrix) across macOS+Windows+Linux.
>
> **Deliverables**:
> - `apps/renderer/tests/component/` (moved from `tests/`) — existing 25 mocked Playwright tests
> - `apps/renderer/tests/integration/` — renderer↔real-sidecar HTTP integration suite
> - `apps/sidecar/tests/integration/` — pytest integration suite with real SQLite + stubbed engines
> - `apps/shell/tests/e2e/` — Playwright `_electron.launch()` E2E with real sidecar+engines
> - `apps/renderer/tests/visual/` — visual regression with per-platform baselines under `__snapshots__/{darwin,win32,linux}/`
> - `packages/test-helpers/` — shared library (sidecar handshake helper, secret scrubber, HF model cache helper, electron launch helper, test mode sentinel)
> - `.github/workflows/test-pr.yml` — PR tier (Linux smoke ~15 min)
> - `.github/workflows/test-main.yml` — Main tier (Linux integration + visual ~30 min)
> - `.github/workflows/test-nightly.yml` — Nightly tier (3-platform matrix + real engines ~90 min)
> - `.github/workflows/update-visual-baselines.yml` — workflow_dispatch for baseline regeneration
> - `apps/sidecar/scripts/required-models.json` — HF model manifest (musicgen-small + whisper-tiny with revision SHA)
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: T1 (test-helpers scaffold) → T2 (sidecar handshake helper) → T3 (secret scrubber) → T8-T13 (per-layer tests) → T20-T23 (CI workflows) → F1-F4

---

## Context

### Original Request

> "The project lacks integration and e2e testing with playwright. Add those. ulw."

The audiomorph-studio project shipped at commit `efa4f08` (all 38 build tasks complete, all 5 installers produced, `pnpm dev` + `pnpm test` green). The existing test surface is:

- **96 vitest tests** in `apps/shell` (unit, IPC, vault, sidecar spawn)
- **53 pytest tests** in `apps/sidecar` (unit-level FastAPI, settings, engines)
- **25 Playwright tests** in `apps/renderer/tests/` — all use `page.addInitScript` to inject `window.__AUDIOMORPH_IPC__` mocks and `page.route()` to mock sidecar HTTP. These are component-level, not true integration/e2e.
- **0 CI test workflows** — only `release.yml` exists, which builds installers but runs no tests.

### Interview Summary

**Key Discussions**:
- All six testing layers in scope (no shortcuts — ulw mode)
- Real engines for Electron E2E with HF model caching (musicgen-small ~2GB + whisper-tiny ~75MB)
- Visual regression on all routes × light/dark × 3 platforms with separate baselines per OS
- Sidecar pytest integration uses real SQLite tempfile + stubbed engines
- CI matrix covers all 3 platforms — user accepted ~10x macOS cost
- Single plan mandate: all six layers in this one file

**Locked Decisions** (from user Q&A round):
- **CI Tiering**: Tiered — PR-smoke (Linux only, ~15 min) / Main-integration (Linux, ~30 min) / Nightly-full-matrix (3 platforms, ~90 min)
- **Existing 25 mocked tests**: Reclassify as 'component' tests, move to `apps/renderer/tests/component/`
- **Real engine depth**: Functional (5s musicgen output, 3s whisper transcription)
- **Visual baselines**: PR comment with diff images, manual local update via `pnpm test:visual:update`
- **Time budgets**: Strict caps with job cancellation (component <2min, integration <5min, E2E <25min/platform, visual <10min, pytest-integration <8min; PR total <15min, nightly total <90min)
- **OpenRouter testing**: Always mock `/openrouter/chat` in CI (no real API key cost)
- **Test mode sentinel**: `AUDIOMORPH_TEST_MODE=1` env var gates memory vault, fixed token, deterministic IDs, telemetry off, secret scrubber active

### Research Findings

- Existing `apps/renderer/playwright.config.ts` uses `bun x serve@latest out -l 3000` (static export, NOT `next dev`). New integration config must spawn real sidecar; new E2E config uses `_electron.launch()` against built shell.
- All existing renderer tests inject `window.__AUDIOMORPH_IPC__` mock — incompatible with real Electron IPC. Component-tier preserves this; integration/E2E forbid it.
- Sidecar uses dynamic port (`--port=0`) with first-stdout-line JSON handshake: `{"event":"listening","port":N,"token":"..."}`. All test layers spawning sidecar need a shared helper.
- `apps/shell/vitest.config.ts` already emits JUnit to `.test-results/shell.xml` — new layers follow this pattern.
- Renderer `next build` produces static export in `apps/renderer/out/`. E2E uses built shell + built renderer (not dev mode).
- `release.yml` workflow is untouched in this plan — new test workflows are separate files.

### Metis Review

**Identified Gaps** (all addressed in this plan):
- **Time budgets**: Locked with strict caps + auto-cancel per Metis Q1
- **Engine depth**: Functional 5s/3s per Metis Q2
- **Existing tests fate**: Reclassify as component per Metis Q3
- **Test data**: Audio fixtures committed to repo (1 small WAV ~50KB); lyric fixtures committed; visual baselines committed (~7MB total: 6 routes × 2 themes × 3 platforms ≈ 36 PNGs × ~200KB)
- **Flake policy**: Zero retry for unit/integration; max 1 retry for E2E with explicit flake report; visual regressions require manual baseline approval
- **Baseline updates**: Manual local update only per Metis Q6
- **Secret handling**: OpenRouter always mocked per Metis Q7; HF model not gated currently but manifest pins revision SHA for reproducibility; macOS code signing not required for dev-build E2E (Gatekeeper bypass via `xattr -d com.apple.quarantine` in CI script)
- **Diagnostics route**: Covered in both integration and E2E layers (T9, T12)
- **Tiering**: Per Metis Q9 — PR/Main/Nightly tiers locked
- **Artifact retention**: Playwright traces+screenshots on failure, videos on E2E failure only, sidecar logs scrubbed, 30-day retention, visual diffs attached to PR comment
- **Test mode sentinel**: `AUDIOMORPH_TEST_MODE=1` per Metis MUST
- **Sidecar log scrubbing**: Mandatory secret scrubber in T3 before any artifact upload

---

## Work Objectives

### Core Objective

Land a comprehensive, tiered testing infrastructure (component + renderer-integration + sidecar-pytest-integration + electron-E2E-with-real-engines + cross-platform visual regression) wired to CI workflows that enforce strict time budgets and cost discipline, without modifying any existing product code or the release.yml workflow.

### Concrete Deliverables

- `packages/test-helpers/src/sidecar.ts` — `spawnSidecar()`, `waitForSidecarReady(proc, {timeoutMs: 60000})`, `killSidecar(proc)`
- `packages/test-helpers/src/scrubber.ts` — `scrubSecrets(text)`, `scrubFile(path)` removing `X-Audiomorph-Token`, `Authorization`, `sk-or-*`, `hf_*` patterns
- `packages/test-helpers/src/hf-cache.ts` — `getCachedModelPath(modelId, revision)`, `verifyModelManifest()`
- `packages/test-helpers/src/electron.ts` — `launchElectronApp(opts): Promise<ElectronApplication>` with auto-cleanup
- `packages/test-helpers/src/test-mode.ts` — constants `TEST_MODE_ENV`, `TEST_TOKEN`, `TEST_VAULT_MODE`
- `apps/renderer/tests/component/` — 25 reclassified Playwright specs (moved, mocking preserved)
- `apps/renderer/tests/integration/` — new spec files: `journey-generate.spec.ts`, `journey-models.spec.ts`, `journey-lyrics.spec.ts`, `journey-settings.spec.ts`, `journey-diagnostics.spec.ts`, `journey-first-run.spec.ts`
- `apps/sidecar/tests/integration/` — new pytest files: `test_jobs_lifecycle.py`, `test_sse_events.py`, `test_settings_persistence.py`, `test_lyrics_storage.py`, `test_openrouter_proxy.py`, `test_first_run.py`, `test_export_flow.py`
- `apps/shell/tests/e2e/` — new e2e specs: `app-boot.spec.ts`, `real-generation.spec.ts`, `real-transcription.spec.ts`, `cancellation.spec.ts`, `vault-lifecycle.spec.ts`, `diagnostics-live.spec.ts`
- `apps/renderer/tests/visual/` — `routes.spec.ts` with `darwin`, `win32`, `linux` baseline directories
- `apps/sidecar/scripts/required-models.json` — manifest with model IDs + revision SHAs
- `apps/renderer/playwright.config.ts` — split into `playwright.component.config.ts`, `playwright.integration.config.ts`, `playwright.visual.config.ts`
- `apps/shell/playwright.e2e.config.ts` — new config for Electron E2E
- Root `package.json` scripts: `test:component`, `test:integration`, `test:e2e`, `test:visual`, `test:sidecar-integration`, `test:visual:update`
- `.github/workflows/test-pr.yml`, `test-main.yml`, `test-nightly.yml`, `update-visual-baselines.yml`

### Definition of Done

- [ ] `pnpm test:component` exits 0, produces `.test-results/component.xml` with ≥25 tests
- [ ] `pnpm test:integration` exits 0 against real spawned sidecar, produces `.test-results/integration.xml` with ≥18 tests (6 specs × ~3 tests each)
- [ ] `pnpm test:sidecar-integration` exits 0 with real SQLite tempfiles, produces `.test-results/sidecar-integration.xml` with ≥21 tests (7 files × ~3 tests each)
- [ ] `pnpm test:e2e` exits 0 against built Electron shell + real sidecar + real engines, produces `.test-results/e2e.xml` with ≥12 tests (6 specs × ~2 tests each), wall time <25 min
- [ ] `pnpm test:visual` exits 0 with platform-correct baselines, produces `.test-results/visual.xml` with ≥36 snapshot comparisons (6 routes × 2 themes × 3 platforms, current platform only per run)
- [ ] `gh workflow run test-pr.yml --ref test-branch-known-good` produces green check, total wall time <15 min
- [ ] `gh workflow run test-nightly.yml --ref main` produces green check, total wall time <90 min, model cache hit on second run
- [ ] Visual diff PR: deliberately changing 1 pixel in a tracked component produces failing test + diff artifact on PR comment
- [ ] Cache invalidation: changing model revision SHA in manifest forces re-download on next CI run (verified via job log)
- [ ] Secret scrubber: planted token `sk-or-v1-PLANTED-FAKE-TEST-TOKEN` in sidecar log does NOT appear in uploaded artifact (`unzip artifact.zip && grep -r PLANTED-FAKE` returns 0 matches)
- [ ] Zero existing tests broken: `pnpm test` (root) still exits 0 with same vitest+pytest counts as commit `efa4f08`
- [ ] `release.yml` untouched (git diff shows no changes to this file)

### Must Have

- Single `AUDIOMORPH_TEST_MODE=1` env var gates ALL test-only behavior across renderer, shell, sidecar
- Shared `packages/test-helpers/` library — single source of truth for sidecar spawn, handshake, scrubber, model cache
- Per-platform visual baselines (different directories for darwin/win32/linux)
- Tiered CI: PR (Linux smoke), Main (Linux full), Nightly (3-platform matrix with real engines)
- Strict job-level timeouts with auto-cancel
- Secret scrubber MUST run before any failure artifact upload
- JUnit XML output for every test layer matching `.test-results/{layer}.xml` pattern
- HF model manifest with pinned revision SHA for reproducibility

### Must NOT Have (Guardrails)

- **NO new mocking in integration/E2E layers** — if a test mocks anything sidecar-related, it belongs in `component/`, not `integration/` or `e2e/`
- **NO `page.waitForTimeout()` arbitrary waits** — only `waitForSelector`, `waitForResponse`, `waitForEvent`, `expect().toBeVisible({timeout})`
- **NO auto-update of visual baselines on main** — baseline changes require local `pnpm test:visual:update` + manual commit + PR review
- **NO retry to mask flakiness** — zero retry for unit/integration; E2E max 1 retry with flake report logged
- **NO hardcoded ports** — every sidecar spawn discovers port via handshake
- **NO model downloads inside test setup** — pre-warmed cache or fail-fast with clear error message
- **NO real-engine E2E on PR tier** — nightly only
- **NO real OpenRouter API calls in any CI tier** — always mocked
- **NO modifications to existing `release.yml`** — new test workflows are separate files
- **NO macOS jobs on PR tier** — Linux only on PR (cost)
- **NO Google Fonts in test pages** (existing constraint)
- **NO raw hex/rgb colors in test assertions** — OKLCH only (existing constraint)
- **NO `localStorage` for any test secrets** (existing constraint)
- **NO `shell=True` in any subprocess spawn** (existing constraint)
- **NO modifications to existing 96 vitest tests or 53 pytest tests** — additive only
- **NO modifications to product source code in `apps/sidecar/src/`, `apps/shell/src/`, `apps/renderer/src/`** — except minimal hooks for `AUDIOMORPH_TEST_MODE` (clearly marked, behind env check)
- **NO logging of HF_TOKEN, X-Audiomorph-Token, sk-or-* anywhere** — scrubber enforces
- **NO test skipping orphan sidecar cleanup** — every spawn MUST have afterEach with PID assertion
- **NO performance benchmarking** (out of scope)
- **NO accessibility audit suite** (out of scope; single axe-core smoke OK per route if cheap)
- **NO mutation testing** (out of scope)
- **NO load/stress testing** (out of scope)
- **NO contract test framework** (integration layer covers this implicitly)
- **NO replacing Playwright with another framework**
- **NO test-coverage thresholds on existing suites** (additive only)
- **NO Jest** (existing constraint)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (vitest in shell, pytest in sidecar, Playwright in renderer)
- **Automated tests**: TDD where practical (acceptance criteria specify expected counts upfront); test-files-first for new layers
- **Framework**: Playwright (component/integration/E2E/visual), pytest (sidecar integration), no new framework
- **If TDD**: Each test-layer task lists expected test count and file paths upfront — RED before implementation is "no test file exists", GREEN is "file exists with N passing tests"

### QA Policy

Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **TUI/CLI**: Use interactive_bash (tmux) — Run command, validate output, check exit code
- **API/Backend**: Use Bash (curl) — Send requests, assert status + response fields
- **Library/Module**: Use Bash (bun/node REPL) — Import, call functions, compare output
- **CI workflow**: Use Bash (`gh workflow run` + `gh run watch`) — Trigger workflow, verify status, download artifacts, grep for content

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - start immediately, MAX PARALLEL):
├── T1: packages/test-helpers/ scaffold + types  [quick]
├── T2: HF model manifest + cache helper  [quick]
├── T3: Secret scrubber helper  [quick]
├── T4: Test mode sentinel + minimal product hooks  [quick]
├── T5: Move 25 existing tests to apps/renderer/tests/component/  [quick]
├── T6: Audio + lyric fixtures committed to packages/test-helpers/fixtures/  [quick]
└── T7: Root package.json scripts + per-app playwright config splits  [quick]

Wave 2 (Per-layer tests - depends Wave 1, MAX PARALLEL):
├── T8:  Sidecar spawn helper (depends T1, T2, T4)  [deep]
├── T9:  Electron launch helper (depends T1, T4)  [deep]
├── T10: Renderer integration suite — 6 specs (depends T7, T8)  [unspecified-high]
├── T11: Sidecar pytest integration suite — 7 files (depends T4)  [unspecified-high]
├── T12: Visual regression suite (depends T7)  [visual-engineering]
└── T13: Component config update for moved tests (depends T5, T7)  [quick]

Wave 3 (E2E + CI scaffolding - depends Wave 2, MAX PARALLEL):
├── T14: Electron E2E suite — 6 specs (depends T8, T9)  [deep]
├── T15: Real-engine smoke validation script (depends T8, T2)  [deep]
├── T16: Sidecar log scrubber integration in spawn helper (depends T3, T8)  [quick]
├── T17: Per-platform visual baseline directory structure + .gitattributes (depends T12)  [quick]
├── T18: PR comment diff bot script (depends T12)  [quick]
└── T19: Local helper scripts: test:visual:update, test:e2e:debug (depends T9, T12)  [quick]

Wave 4 (CI workflows + tier wiring - depends Wave 3, MAX PARALLEL):
├── T20: .github/workflows/test-pr.yml — Linux smoke tier  [unspecified-high]
├── T21: .github/workflows/test-main.yml — Linux full + visual tier  [unspecified-high]
├── T22: .github/workflows/test-nightly.yml — 3-platform matrix with real engines  [unspecified-high]
├── T23: .github/workflows/update-visual-baselines.yml — workflow_dispatch  [quick]
└── T24: CI cost guards + cache strategy validation (depends T2, T20, T21, T22)  [deep]

Wave FINAL (after ALL tasks — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA — trigger all 4 CI workflows on test branches (unspecified-high)
└── F4: Scope fidelity check — verify no product code modified except test-mode hooks (deep)
→ Present results → Get explicit user okay

Critical Path: T1 → T8 → T14 → T22 → F1-F4 → user okay
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 7 (Wave 1)
```

### Dependency Matrix

- **T1**: depends none — blocks T8, T9, T10, T11, T12
- **T2**: depends none — blocks T8, T15, T24
- **T3**: depends none — blocks T16
- **T4**: depends none — blocks T8, T9, T10, T11, T14
- **T5**: depends none — blocks T13
- **T6**: depends none — blocks T10, T11, T14
- **T7**: depends none — blocks T10, T12, T13
- **T8**: depends T1, T2, T4 — blocks T10, T14, T15, T16
- **T9**: depends T1, T4 — blocks T14, T19
- **T10**: depends T6, T7, T8 — blocks T20, T21, T22
- **T11**: depends T4, T6 — blocks T20, T21, T22
- **T12**: depends T7 — blocks T17, T18, T19, T21, T22
- **T13**: depends T5, T7 — blocks T20, T21, T22
- **T14**: depends T6, T8, T9 — blocks T22
- **T15**: depends T2, T8 — blocks T22
- **T16**: depends T3, T8 — blocks T20, T21, T22
- **T17**: depends T12 — blocks T21, T22
- **T18**: depends T12 — blocks T21
- **T19**: depends T9, T12 — blocks nothing (dev convenience)
- **T20**: depends T10, T11, T13, T16 — blocks T24, F1-F4
- **T21**: depends T10, T11, T12, T13, T16, T17, T18 — blocks T24, F1-F4
- **T22**: depends T10, T11, T12, T13, T14, T15, T16, T17 — blocks T24, F1-F4
- **T23**: depends T12, T17 — blocks F1-F4
- **T24**: depends T2, T20, T21, T22 — blocks F1-F4

### Agent Dispatch Summary

- **Wave 1**: 7 tasks — T1-T7 all `quick`
- **Wave 2**: 6 tasks — T8 `deep`, T9 `deep`, T10 `unspecified-high`, T11 `unspecified-high`, T12 `visual-engineering`, T13 `quick`
- **Wave 3**: 6 tasks — T14 `deep`, T15 `deep`, T16-T19 `quick`
- **Wave 4**: 5 tasks — T20-T22 `unspecified-high`, T23 `quick`, T24 `deep`
- **FINAL**: 4 tasks — F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. **Scaffold `packages/test-helpers/` workspace package**

  **What to do**:
  - Create `packages/test-helpers/package.json` with name `@audiomorph/test-helpers`, type `module`, exports map for `./sidecar`, `./scrubber`, `./hf-cache`, `./electron`, `./test-mode`, `./fixtures`
  - Create `packages/test-helpers/tsconfig.json` extending root tsconfig
  - Create `packages/test-helpers/src/index.ts` re-exporting all sub-modules
  - Create empty stub files: `src/sidecar.ts`, `src/scrubber.ts`, `src/hf-cache.ts`, `src/electron.ts`, `src/test-mode.ts` with `export {}`
  - Add to root `pnpm-workspace.yaml` packages array if not already covered by glob
  - Add devDependencies: `@playwright/test`, `@types/node`, `typescript`
  - Run `pnpm install` from root to wire workspace links

  **Must NOT do**:
  - Implement actual helper logic (later tasks do this)
  - Add runtime dependencies beyond `@playwright/test` and types
  - Create any non-`.ts` source files
  - Modify product packages' package.json files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure scaffolding — file/directory creation with known templates, no logic
  - **Skills**: []
    - No skill needed; mechanical creation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T3, T4, T5, T6, T7)
  - **Blocks**: T8, T9, T10, T11, T12
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/heartlib/package.json` - Existing workspace package pattern (read-only submodule — do NOT modify, just match structure)
  - `apps/shell/package.json:exports` - Exports map pattern with multiple entry points
  - `apps/shell/tsconfig.json` - tsconfig extends pattern

  **External References**:
  - pnpm workspace docs: `https://pnpm.io/workspaces` - Workspace protocol syntax
  - Playwright test API: `https://playwright.dev/docs/api/class-test` - Type imports needed

  **WHY Each Reference Matters**:
  - `heartlib/package.json` shows existing workspace package layout — match directory naming and tsconfig structure for consistency
  - `apps/shell/package.json:exports` demonstrates the multi-entry exports map pattern needed for sub-module imports (e.g., `@audiomorph/test-helpers/sidecar`)
  - pnpm workspace docs confirm whether glob in `pnpm-workspace.yaml` already covers `packages/*` or if explicit add needed

  **Acceptance Criteria**:

  - [ ] Directory `packages/test-helpers/` exists with `src/`, `package.json`, `tsconfig.json`
  - [ ] `cd packages/test-helpers && pnpm typecheck` exits 0
  - [ ] From root: `node -e "import('@audiomorph/test-helpers').then(m => console.log(Object.keys(m)))"` lists at least: sidecar, scrubber, hfCache, electron, testMode
  - [ ] `pnpm list -r @audiomorph/test-helpers` shows package resolved in workspace

  **QA Scenarios**:

  ```
  Scenario: Workspace package resolves and exports stub modules
    Tool: Bash
    Preconditions: pnpm install completed from root
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. pnpm install
      3. node --input-type=module -e "import * as h from '@audiomorph/test-helpers'; console.log(JSON.stringify(Object.keys(h)))"
    Expected Result: stdout contains array with at least 5 named exports including 'sidecar', 'scrubber', 'hfCache', 'electron', 'testMode'; exit code 0
    Failure Indicators: ERR_MODULE_NOT_FOUND, empty exports, non-zero exit
    Evidence: .sisyphus/evidence/task-1-workspace-resolution.txt

  Scenario: Typecheck passes on new package
    Tool: Bash
    Preconditions: package scaffolded
    Steps:
      1. cd packages/test-helpers && pnpm typecheck 2>&1 | tee /tmp/tc.log
    Expected Result: Exit code 0, output contains no "error TS"
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-workspace-resolution.txt (stdout of node import test)
  - [ ] task-1-typecheck.txt (typecheck output)

  **Commit**: YES
  - Message: `test(helpers): scaffold @audiomorph/test-helpers workspace package`
  - Files: `packages/test-helpers/package.json`, `packages/test-helpers/tsconfig.json`, `packages/test-helpers/src/*.ts`, `pnpm-workspace.yaml` (if modified), `pnpm-lock.yaml`
  - Pre-commit: `pnpm typecheck && pnpm lint packages/test-helpers`

- [ ] 2. **HF model manifest + cache helper**

  **What to do**:
  - Create `apps/sidecar/scripts/required-models.json` with two entries: `{id: "facebook/musicgen-small", revision: "<pinned-sha>", size_mb: 2000}` and `{id: "openai/whisper-tiny", revision: "<pinned-sha>", size_mb: 75}`
  - Resolve actual revision SHAs via `huggingface-cli api repos/get facebook/musicgen-small` (or HTTP `https://huggingface.co/api/models/facebook/musicgen-small` → `sha` field of main branch)
  - Implement `packages/test-helpers/src/hf-cache.ts`:
    - `loadManifest(): ModelManifest[]` reads `apps/sidecar/scripts/required-models.json`
    - `getCachedModelPath(id, revision): string` returns `~/.cache/huggingface/hub/models--<org>--<name>/snapshots/<revision>/`
    - `verifyModelManifest(): {ok: boolean, missing: string[]}` checks each manifest entry exists in cache
    - `getCacheKey(): string` returns SHA256 of manifest JSON content for CI cache key
  - Add `packages/test-helpers/src/hf-cache.test.ts` with vitest unit tests for `getCacheKey` determinism and `loadManifest` schema

  **Must NOT do**:
  - Trigger actual model downloads inside helper (helpers only read/verify)
  - Hardcode home directory — use `os.homedir()`
  - Include `HF_TOKEN` in any log or error message
  - Add network calls in `verifyModelManifest` (filesystem-only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Manifest creation + small helper with filesystem ops; one-shot resolution of SHAs
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3, T4, T5, T6, T7)
  - **Blocks**: T8, T15, T24
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `apps/sidecar/src/engines/musicgen.py` - Existing musicgen integration showing model ID used at runtime; manifest must match
  - `apps/sidecar/src/engines/whisper.py` - Existing whisper integration; confirm model ID and revision pattern

  **External References**:
  - HF cache structure: `https://huggingface.co/docs/huggingface_hub/guides/manage-cache#understand-caching` - Directory layout under `~/.cache/huggingface/hub/`
  - HF API: `https://huggingface.co/api/models/facebook/musicgen-small` - JSON endpoint returning revision SHA

  **WHY Each Reference Matters**:
  - `engines/musicgen.py` confirms the EXACT model id string used in production — manifest must match byte-for-byte or test cache won't match runtime
  - HF cache docs document the deterministic path pattern (`models--<org>--<name>/snapshots/<sha>/`) needed for `getCachedModelPath`

  **Acceptance Criteria**:

  - [ ] `apps/sidecar/scripts/required-models.json` exists with 2 entries, each having `id`, `revision` (40-char SHA), `size_mb`
  - [ ] `node -e "import('@audiomorph/test-helpers/hf-cache').then(m => console.log(m.getCacheKey()))"` outputs deterministic 64-char hex
  - [ ] Same command run twice produces identical output (determinism)
  - [ ] `cd packages/test-helpers && pnpm test hf-cache` passes ≥3 tests
  - [ ] Manifest validates against JSON schema (each entry has required fields)

  **QA Scenarios**:

  ```
  Scenario: Manifest cache key is deterministic
    Tool: Bash
    Preconditions: T2 implementation complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. K1=$(node --input-type=module -e "import {getCacheKey} from '@audiomorph/test-helpers/hf-cache'; console.log(getCacheKey())")
      3. K2=$(node --input-type=module -e "import {getCacheKey} from '@audiomorph/test-helpers/hf-cache'; console.log(getCacheKey())")
      4. test "$K1" = "$K2" && echo SAME || echo DIFFERENT
    Expected Result: stdout "SAME", both keys are 64-char lowercase hex
    Evidence: .sisyphus/evidence/task-2-cache-key-determinism.txt

  Scenario: verifyModelManifest reports missing when cache empty
    Tool: Bash
    Preconditions: Temp HF cache dir empty
    Steps:
      1. TMPCACHE=$(mktemp -d)
      2. HF_HOME=$TMPCACHE node --input-type=module -e "import {verifyModelManifest} from '@audiomorph/test-helpers/hf-cache'; const r = verifyModelManifest(); console.log(JSON.stringify(r))"
    Expected Result: JSON with ok=false, missing array containing both model ids
    Evidence: .sisyphus/evidence/task-2-missing-detection.txt

  Scenario: Manifest schema validation rejects bad entry
    Tool: Bash
    Preconditions: Helper implements schema validation
    Steps:
      1. Create bad manifest at /tmp/bad-manifest.json missing 'revision' field
      2. AUDIOMORPH_MANIFEST_PATH=/tmp/bad-manifest.json node --input-type=module -e "import {loadManifest} from '@audiomorph/test-helpers/hf-cache'; try {loadManifest()} catch(e){console.error(e.message); process.exit(1)}"
    Expected Result: Exit code 1, stderr contains "revision" or "schema"
    Evidence: .sisyphus/evidence/task-2-schema-rejection.txt
  ```

  **Evidence to Capture**:
  - [ ] task-2-cache-key-determinism.txt
  - [ ] task-2-missing-detection.txt
  - [ ] task-2-schema-rejection.txt

  **Commit**: YES
  - Message: `test(helpers): add HF model manifest and cache helper`
  - Files: `apps/sidecar/scripts/required-models.json`, `packages/test-helpers/src/hf-cache.ts`, `packages/test-helpers/src/hf-cache.test.ts`
  - Pre-commit: `pnpm typecheck && cd packages/test-helpers && pnpm test hf-cache`

- [ ] 3. **Secret scrubber helper**

  **What to do**:
  - Implement `packages/test-helpers/src/scrubber.ts`:
    - `SECRET_PATTERNS: RegExp[]` covering: `X-Audiomorph-Token: \S+`, `Authorization: Bearer \S+`, `sk-or-[a-zA-Z0-9-]+`, `hf_[a-zA-Z0-9]+`, `Bearer [A-Za-z0-9._-]{20,}`, exact-token match for known test token
    - `scrubSecrets(text: string): string` — replaces matches with `[REDACTED-<pattern-name>]`
    - `scrubFile(path: string): Promise<{replacements: number}>` — reads, scrubs, writes atomically
    - `scrubDirectory(dir: string): Promise<{filesProcessed: number, replacements: number}>` — recursive
    - CLI entry: `bin/scrubber-cli.js` for shell usage (chmod +x, shebang `#!/usr/bin/env node`)
  - Add `packages/test-helpers/src/scrubber.test.ts` with vitest unit tests:
    - Each pattern matched and redacted
    - Plain text unchanged
    - Multi-line preserved
    - Idempotent (scrubbing scrubbed output produces same result)
    - File scrubbing atomic (no partial writes)
  - Add `package.json` `"bin"` field exposing `scrubber-cli` binary

  **Must NOT do**:
  - Use `eval` or dynamic regex from user input
  - Silently mask without counting replacements
  - Modify files in place without atomic rename
  - Log the actual matched secret content (only pattern name in logs)
  - Catch and swallow errors silently

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure function library with regex patterns and unit tests — bounded, no I/O complexity beyond fs read/write
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T4, T5, T6, T7)
  - **Blocks**: T16
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `apps/sidecar/src/auth.py` - Token format used in production (`X-Audiomorph-Token` header) — scrubber must match this exact format
  - `apps/shell/src/sidecar/spawn.ts` - Where token is generated/logged in shell — confirm log format scrubber must handle
  - `apps/shell/src/openrouter/client.ts` - OpenRouter API key format (`sk-or-*`) — pattern must match

  **External References**:
  - Node fs atomic write: `https://nodejs.org/api/fs.html#fspromisesrenamesrc-dest` - Atomic rename pattern for safe file writes

  **WHY Each Reference Matters**:
  - `apps/sidecar/src/auth.py` shows the exact header name and token format used at runtime — regex must match production string
  - `apps/shell/src/sidecar/spawn.ts` shows what currently lands in shell logs — those lines must be scrubbed before artifact upload
  - `openrouter/client.ts` confirms `sk-or-` prefix pattern for OpenRouter keys (vs OpenAI `sk-`)

  **Acceptance Criteria**:

  - [ ] `packages/test-helpers/src/scrubber.ts` exports `scrubSecrets`, `scrubFile`, `scrubDirectory`, `SECRET_PATTERNS`
  - [ ] `bin/scrubber-cli.js` executable with shebang
  - [ ] `pnpm test scrubber` passes ≥8 unit tests
  - [ ] All known secret patterns redacted in test fixtures
  - [ ] Scrubbing is idempotent (verified via test)
  - [ ] File scrubbing is atomic (verified by killing process mid-scrub doesn't leave partial file)

  **QA Scenarios**:

  ```
  Scenario: Planted secrets in log file are all redacted
    Tool: Bash
    Preconditions: Scrubber CLI built and linked
    Steps:
      1. cat > /tmp/test-log.txt <<EOF
      Starting sidecar...
      X-Audiomorph-Token: abc123def456ghi789
      Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.PLANTED
      OpenRouter key: sk-or-v1-PLANTED-FAKE-TOKEN-12345
      HF token: hf_PLANTEDhuggingfaceTokenAbc123
      Normal log line
      EOF
      2. node packages/test-helpers/bin/scrubber-cli.js /tmp/test-log.txt
      3. grep -E "(abc123def456|PLANTED|sk-or-v1-PLANTED|hf_PLANTED)" /tmp/test-log.txt
    Expected Result: grep exit code 1 (no matches found); file contains 4 [REDACTED-*] markers; "Normal log line" preserved
    Evidence: .sisyphus/evidence/task-3-scrub-planted-secrets.txt

  Scenario: Idempotent scrubbing produces stable output
    Tool: Bash
    Preconditions: Scrubber implementation complete
    Steps:
      1. cp /tmp/test-log.txt /tmp/scrubbed-once.txt
      2. node packages/test-helpers/bin/scrubber-cli.js /tmp/scrubbed-once.txt
      3. cp /tmp/scrubbed-once.txt /tmp/scrubbed-twice.txt
      4. node packages/test-helpers/bin/scrubber-cli.js /tmp/scrubbed-twice.txt
      5. diff /tmp/scrubbed-once.txt /tmp/scrubbed-twice.txt
    Expected Result: diff produces no output, exit code 0
    Evidence: .sisyphus/evidence/task-3-idempotent.txt

  Scenario: Clean text passes through unchanged
    Tool: Bash
    Preconditions: Scrubber CLI built
    Steps:
      1. echo "Hello world, no secrets here, just plain text" > /tmp/clean.txt
      2. ORIGINAL=$(cat /tmp/clean.txt)
      3. node packages/test-helpers/bin/scrubber-cli.js /tmp/clean.txt
      4. test "$(cat /tmp/clean.txt)" = "$ORIGINAL" && echo UNCHANGED || echo MODIFIED
    Expected Result: stdout "UNCHANGED"
    Evidence: .sisyphus/evidence/task-3-clean-unchanged.txt
  ```

  **Evidence to Capture**:
  - [ ] task-3-scrub-planted-secrets.txt
  - [ ] task-3-idempotent.txt
  - [ ] task-3-clean-unchanged.txt

  **Commit**: YES
  - Message: `test(scrubber): add secret redaction helper with CLI`
  - Files: `packages/test-helpers/src/scrubber.ts`, `packages/test-helpers/src/scrubber.test.ts`, `packages/test-helpers/bin/scrubber-cli.js`, `packages/test-helpers/package.json` (bin field)
  - Pre-commit: `pnpm typecheck && cd packages/test-helpers && pnpm test scrubber`

- [ ] 4. **Test mode sentinel + minimal product hooks**

  **What to do**:
  - Implement `packages/test-helpers/src/test-mode.ts`:
    - `export const TEST_MODE_ENV = 'AUDIOMORPH_TEST_MODE'`
    - `export const TEST_TOKEN = 'test-token-deterministic-do-not-use-in-prod'`
    - `export const TEST_VAULT_MODE = 'memory'`
    - `export function isTestMode(): boolean` reads `process.env[TEST_MODE_ENV] === '1'`
    - `export function assertTestMode(): void` throws if not in test mode (use in test setup)
    - `export function getTestEnv(): Record<string, string>` returns env dict to pass to spawned processes
  - Add minimal product hooks (CLEARLY MARKED with `// AUDIOMORPH_TEST_MODE hook` comment), guarded by `if (process.env.AUDIOMORPH_TEST_MODE === '1')`:
    - `apps/sidecar/src/vault.py` — if test mode, use in-memory dict instead of keyring
    - `apps/sidecar/src/auth.py` — if test mode, accept fixed `TEST_TOKEN` value
    - `apps/sidecar/src/telemetry.py` — if test mode, no-op all telemetry (already no telemetry, but enforce)
    - `apps/sidecar/src/ids.py` (or wherever UUIDs generated) — if test mode, use monotonic counter for deterministic IDs
    - `apps/shell/src/sidecar/spawn.ts` — if test mode, pass `AUDIOMORPH_TEST_MODE=1` env to spawned sidecar
    - `apps/renderer/src/lib/api-base.ts` (or wherever `window.__AUDIOMORPH_API_BASE__` read) — if `window.__AUDIOMORPH_TEST_MODE__` set, expose test mode to renderer code
  - In every hook: import `TEST_TOKEN` constant from a shared TS const file OR mirror exact string in Python `tests/conftest.py` constant
  - Sidecar MUST refuse to start in CI without `AUDIOMORPH_TEST_MODE=1` when env var `CI=true` is set (safety check)

  **Must NOT do**:
  - Change any logic outside the `if (testMode)` guard
  - Use test mode for any production code path
  - Hardcode test token in product source — import from shared module
  - Skip the `CI && !TEST_MODE` safety refuse check
  - Modify product code style/formatting beyond the hook (no opportunistic refactors)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, surgical edits to known files; constants and guard clauses
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T3, T5, T6, T7)
  - **Blocks**: T8, T9, T10, T11, T14
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `apps/sidecar/src/vault.py` - Existing keyring-backed vault; new branch goes here
  - `apps/sidecar/src/auth.py` - Token validation; new accepts-test-token branch goes here
  - `apps/shell/src/sidecar/spawn.ts:spawnSidecar` - Where env passed to child process

  **External References**:
  - Python keyring docs: `https://pypi.org/project/keyring/` - Confirm in-memory backend exists (or roll own dict)

  **WHY Each Reference Matters**:
  - `vault.py` is the integrity point — token storage must be safely isolated from real keyring in tests
  - `auth.py` defines the token validation flow — test-mode branch must accept the deterministic token
  - `spawn.ts` propagates env to subprocess — without this, sidecar won't know it's in test mode

  **Acceptance Criteria**:

  - [ ] `packages/test-helpers/src/test-mode.ts` exports all 6 symbols listed above
  - [ ] All product code hooks marked with `// AUDIOMORPH_TEST_MODE hook` comment for grep-ability
  - [ ] `grep -r "AUDIOMORPH_TEST_MODE hook" apps/ | wc -l` returns exactly 6 (one per hook listed)
  - [ ] With `CI=true` and no test mode set, sidecar exits with code 78 and stderr containing "AUDIOMORPH_TEST_MODE required in CI"
  - [ ] With test mode set, sidecar accepts `TEST_TOKEN` for all authenticated requests
  - [ ] Without test mode set, vault uses keyring (existing tests still pass)

  **QA Scenarios**:

  ```
  Scenario: Sidecar refuses to start in CI without test mode
    Tool: Bash
    Preconditions: Sidecar built with T4 changes
    Steps:
      1. cd apps/sidecar
      2. CI=true python -m audiomorph_sidecar --port=0 2>&1 | tee /tmp/sidecar-refuse.log; CODE=${PIPESTATUS[0]}
      3. test $CODE -eq 78 && grep -q "AUDIOMORPH_TEST_MODE required in CI" /tmp/sidecar-refuse.log && echo REFUSED || echo FAILED
    Expected Result: stdout "REFUSED", exit code 78, stderr contains required message
    Evidence: .sisyphus/evidence/task-4-ci-refuse.txt

  Scenario: Test mode enables in-memory vault + deterministic token
    Tool: Bash
    Preconditions: Sidecar built with T4 changes
    Steps:
      1. AUDIOMORPH_TEST_MODE=1 python -m audiomorph_sidecar --port=0 &
      2. SIDECAR_PID=$!
      3. sleep 2  # await handshake (T8 will replace with proper helper)
      4. PORT=$(grep -oP '"port":\s*\K\d+' /tmp/sidecar-handshake.log | head -1)
      5. curl -s -H "X-Audiomorph-Token: test-token-deterministic-do-not-use-in-prod" "http://127.0.0.1:$PORT/health" | jq .status
      6. kill $SIDECAR_PID
    Expected Result: jq output "ok"; auth succeeded with test token
    Evidence: .sisyphus/evidence/task-4-test-token-auth.txt

  Scenario: Existing vault tests still pass (no regression)
    Tool: Bash
    Preconditions: Existing 53 sidecar pytest tests
    Steps:
      1. cd apps/sidecar
      2. pytest tests/ -q 2>&1 | tail -20
    Expected Result: All existing tests pass (count matches commit efa4f08 baseline)
    Evidence: .sisyphus/evidence/task-4-no-regression.txt
  ```

  **Evidence to Capture**:
  - [ ] task-4-ci-refuse.txt
  - [ ] task-4-test-token-auth.txt
  - [ ] task-4-no-regression.txt

  **Commit**: YES
  - Message: `test(test-mode): add AUDIOMORPH_TEST_MODE sentinel and product hooks`
  - Files: `packages/test-helpers/src/test-mode.ts`, `apps/sidecar/src/vault.py`, `apps/sidecar/src/auth.py`, `apps/sidecar/src/telemetry.py`, `apps/sidecar/src/ids.py`, `apps/shell/src/sidecar/spawn.ts`, `apps/renderer/src/lib/api-base.ts`
  - Pre-commit: `pnpm typecheck && pnpm test && cd apps/sidecar && pytest -q`

- [ ] 5. **Move 25 existing Playwright tests to `apps/renderer/tests/component/`**

  **What to do**:
  - Create directory `apps/renderer/tests/component/`
  - Use `git mv` to move all 10 existing `.spec.ts` files from `apps/renderer/tests/` to `apps/renderer/tests/component/` preserving git history
  - Do NOT modify the test content (move only)
  - Update any relative imports inside moved files (e.g., `../fixtures` → `../../fixtures` if needed)
  - Verify all 25 tests still pass under existing config before T7 splits configs
  - Record exact pre-move test count and per-file count for diff verification

  **Must NOT do**:
  - Modify any test logic
  - Change mock patterns inside tests
  - Combine or split spec files
  - Use `cp + rm` instead of `git mv` (loses history)
  - Move fixtures or helpers (those stay at `tests/fixtures/`)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure file relocation with git history preservation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T3, T4, T6, T7)
  - **Blocks**: T13
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `apps/renderer/tests/*.spec.ts` - All 10 existing spec files (the ones being moved)
  - `apps/renderer/playwright.config.ts` - Current config, references `tests/**/*.spec.ts` pattern

  **External References**:
  - Git mv docs: `https://git-scm.com/docs/git-mv` - Preserves history for code review

  **WHY Each Reference Matters**:
  - The existing spec files are the source-of-truth for what tests exist — count them precisely so post-move verification matches
  - `playwright.config.ts` currently picks up specs from `tests/` directly; T7 changes this glob to `tests/component/` for component config

  **Acceptance Criteria**:

  - [ ] `apps/renderer/tests/component/` contains exactly 10 `.spec.ts` files (count matches pre-move)
  - [ ] `apps/renderer/tests/*.spec.ts` returns 0 files (none left at root)
  - [ ] `git log --follow apps/renderer/tests/component/<any>.spec.ts` shows history from before the move
  - [ ] `cd apps/renderer && pnpm exec playwright test --list | grep -c "›"` returns 25 (same total test count as before move)
  - [ ] No git churn beyond the moves (zero `M` lines in `git status`, only `R` renames)

  **QA Scenarios**:

  ```
  Scenario: All 10 spec files relocated with history preserved
    Tool: Bash
    Preconditions: T5 complete, working tree clean except renames
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. find apps/renderer/tests/component -maxdepth 1 -name "*.spec.ts" | wc -l
      3. find apps/renderer/tests -maxdepth 1 -name "*.spec.ts" | wc -l
      4. git status --short apps/renderer/tests/ | grep "^R" | wc -l
    Expected Result: line 2 outputs 10; line 3 outputs 0; line 4 outputs 10 (10 renames)
    Evidence: .sisyphus/evidence/task-5-relocation-counts.txt

  Scenario: All 25 tests still discoverable and passing
    Tool: Bash
    Preconditions: T5 complete (still using old single config; T7 will split later)
    Steps:
      1. cd apps/renderer
      2. pnpm exec playwright test --list 2>&1 | grep -c "›" > /tmp/count.txt
      3. cat /tmp/count.txt
      4. pnpm exec playwright test 2>&1 | tail -5 | tee /tmp/run.txt
    Expected Result: count.txt contains "25"; run.txt contains "25 passed"
    Evidence: .sisyphus/evidence/task-5-tests-still-pass.txt

  Scenario: Git history follows moved file
    Tool: Bash
    Preconditions: Move committed
    Steps:
      1. SAMPLE=$(ls apps/renderer/tests/component/*.spec.ts | head -1)
      2. git log --follow --oneline "$SAMPLE" | wc -l
    Expected Result: Count >1 (history exists before move)
    Evidence: .sisyphus/evidence/task-5-history-preserved.txt
  ```

  **Evidence to Capture**:
  - [ ] task-5-relocation-counts.txt
  - [ ] task-5-tests-still-pass.txt
  - [ ] task-5-history-preserved.txt

  **Commit**: YES
  - Message: `test(component): relocate existing renderer tests to tests/component/`
  - Files: `apps/renderer/tests/component/*.spec.ts` (renames)
  - Pre-commit: `cd apps/renderer && pnpm exec playwright test`

- [ ] 6. **Commit audio + lyric fixtures to `packages/test-helpers/fixtures/`**

  **What to do**:
  - Create `packages/test-helpers/fixtures/audio/short.wav` — 1-second silent WAV (44.1kHz, 16-bit mono, ~88KB raw, ~50KB after RIFF header). Generate via `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -ac 1 -ar 44100 short.wav`
  - Create `packages/test-helpers/fixtures/audio/short.mp3` — same content MP3 (~10KB)
  - Create `packages/test-helpers/fixtures/audio/speech-3s.wav` — 3-second TTS-generated speech ("hello this is a test recording") via `espeak-ng -w speech-3s.wav "hello this is a test recording"`. Used for whisper transcription test.
  - Create `packages/test-helpers/fixtures/lyrics/sample.txt` — short song lyrics (3 verses, ~50 lines)
  - Create `packages/test-helpers/fixtures/lyrics/empty.txt` — empty file (edge case)
  - Create `packages/test-helpers/fixtures/openrouter/chat-response.json` — canned successful chat response shape matching OpenRouter API
  - Create `packages/test-helpers/fixtures/openrouter/error-401.json` — canned 401 error shape
  - Add `packages/test-helpers/src/fixtures.ts` exporting `getFixturePath(category, name): string`
  - Add `.gitattributes` entries: `*.wav binary`, `*.mp3 binary`, `*.png binary`
  - Verify total fixtures size <500KB

  **Must NOT do**:
  - Use copyrighted audio or lyrics
  - Commit large audio files (>500KB total budget)
  - Include real user data
  - Add fixtures to repo root or product packages
  - Generate fixtures at test time (must be committed binaries)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File creation with ffmpeg/espeak-ng one-liners; bounded scope
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T3, T4, T5, T7)
  - **Blocks**: T10, T11, T14
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `apps/sidecar/tests/` - Check if existing fixtures exist; match naming if so
  - `.gitattributes` - Existing binary file patterns (if file exists at root)

  **External References**:
  - ffmpeg anullsrc: `https://ffmpeg.org/ffmpeg-filters.html#anullsrc` - Silent audio generation
  - espeak-ng: `https://github.com/espeak-ng/espeak-ng` - Open-source TTS for committed test audio

  **WHY Each Reference Matters**:
  - ffmpeg `anullsrc` produces deterministic silent audio — required for stable test inputs
  - espeak-ng output is reproducible — same input text always produces byte-identical WAV with same version

  **Acceptance Criteria**:

  - [ ] `packages/test-helpers/fixtures/audio/short.wav` exists, valid WAV header, ~88KB, duration 1.0s ±0.01s
  - [ ] `packages/test-helpers/fixtures/audio/speech-3s.wav` exists, contains intelligible speech (whisper-tiny transcribes it to recognizable text in T14)
  - [ ] Total `packages/test-helpers/fixtures/**` byte size <500KB (`du -sb packages/test-helpers/fixtures/`)
  - [ ] `getFixturePath('audio', 'short.wav')` returns absolute existing path
  - [ ] `.gitattributes` marks `.wav`, `.mp3`, `.png` as binary

  **QA Scenarios**:

  ```
  Scenario: Audio fixtures are valid and within size budget
    Tool: Bash
    Preconditions: T6 fixtures created
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 packages/test-helpers/fixtures/audio/short.wav
      3. ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 packages/test-helpers/fixtures/audio/speech-3s.wav
      4. du -sb packages/test-helpers/fixtures/ | awk '{print $1}'
    Expected Result: line 2 ≈ 1.000000; line 3 ≈ 3.0xxxxx; line 4 < 512000 (500KB)
    Evidence: .sisyphus/evidence/task-6-fixture-validity.txt

  Scenario: getFixturePath returns existing absolute path
    Tool: Bash
    Preconditions: T6 helper exported
    Steps:
      1. node --input-type=module -e "import {getFixturePath} from '@audiomorph/test-helpers/fixtures'; const p = getFixturePath('audio', 'short.wav'); console.log(p); import('fs').then(fs => console.log(fs.existsSync(p)))"
    Expected Result: First line absolute path; second line "true"
    Evidence: .sisyphus/evidence/task-6-path-resolution.txt
  ```

  **Evidence to Capture**:
  - [ ] task-6-fixture-validity.txt
  - [ ] task-6-path-resolution.txt

  **Commit**: YES
  - Message: `test(fixtures): add audio/lyrics/openrouter test fixtures`
  - Files: `packages/test-helpers/fixtures/**`, `packages/test-helpers/src/fixtures.ts`, `.gitattributes` (if modified)
  - Pre-commit: `du -sb packages/test-helpers/fixtures/ | awk '$1<512000{exit 0}{exit 1}'`

- [ ] 7. **Root scripts + per-app Playwright config splits**

  **What to do**:
  - Update root `package.json` scripts:
    - `"test:component": "cd apps/renderer && pnpm exec playwright test --config=playwright.component.config.ts"`
    - `"test:integration": "cd apps/renderer && pnpm exec playwright test --config=playwright.integration.config.ts"`
    - `"test:visual": "cd apps/renderer && pnpm exec playwright test --config=playwright.visual.config.ts"`
    - `"test:visual:update": "cd apps/renderer && pnpm exec playwright test --config=playwright.visual.config.ts --update-snapshots"`
    - `"test:e2e": "cd apps/shell && pnpm exec playwright test --config=playwright.e2e.config.ts"`
    - `"test:e2e:debug": "cd apps/shell && PWDEBUG=1 pnpm exec playwright test --config=playwright.e2e.config.ts"`
    - `"test:sidecar-integration": "cd apps/sidecar && pytest tests/integration/ -q --junitxml=../../.test-results/sidecar-integration.xml"`
    - `"test:all": "pnpm test && pnpm test:component && pnpm test:integration && pnpm test:sidecar-integration && pnpm test:e2e && pnpm test:visual"`
  - Split existing `apps/renderer/playwright.config.ts` into three configs (rename original then create three):
    - `playwright.component.config.ts` — testDir `tests/component/`, webServer `bun x serve@latest out -l 3000`, reporter JUnit `.test-results/component.xml`, retries 0, timeout 30s
    - `playwright.integration.config.ts` — testDir `tests/integration/`, NO webServer (tests use real spawned sidecar via T8 helper + serve static export themselves), reporter JUnit `.test-results/integration.xml`, retries 0, timeout 60s
    - `playwright.visual.config.ts` — testDir `tests/visual/`, webServer same as component, reporter JUnit `.test-results/visual.xml`, retries 0, timeout 30s, snapshot path template includes `{platform}` token
  - Create `apps/shell/playwright.e2e.config.ts` — testDir `tests/e2e/`, no webServer (uses `_electron.launch()`), reporter JUnit `.test-results/e2e.xml`, retries 1 (E2E only), timeout 120s
  - Delete the original `apps/renderer/playwright.config.ts` AFTER the three splits work
  - Add `.test-results/` to root `.gitignore` if not already present

  **Must NOT do**:
  - Allow webServer in integration or e2e configs (these spawn their own services)
  - Use `--update-snapshots` in default visual config (only via `test:visual:update`)
  - Set retries >0 anywhere except e2e config
  - Remove any existing root `package.json` scripts
  - Modify any existing test code

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Config splits and script additions; mechanical with clear acceptance criteria
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T3, T4, T5, T6)
  - **Blocks**: T10, T12, T13
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `apps/renderer/playwright.config.ts` - Existing config being split (current state)
  - `apps/shell/vitest.config.ts` - JUnit reporter pattern with `.test-results/shell.xml` output

  **External References**:
  - Playwright config: `https://playwright.dev/docs/test-configuration` - testDir, webServer, reporter options
  - Playwright projects/configs: `https://playwright.dev/docs/test-projects` - Multi-config vs projects (we use multi-config for clarity)
  - Playwright snapshot path template: `https://playwright.dev/docs/api/class-testconfig#test-config-snapshot-path-template` - `{platform}` token

  **WHY Each Reference Matters**:
  - Existing config has the webServer pattern (`bun x serve@latest out -l 3000`) needed for component + visual; integration/e2e MUST omit webServer
  - vitest JUnit pattern is the existing convention — match output dir `.test-results/`
  - snapshot path template is critical for per-platform baselines

  **Acceptance Criteria**:

  - [ ] Root `package.json` has all 8 new scripts listed above
  - [ ] `pnpm test:component` runs only `tests/component/*.spec.ts` (verify by `--list`)
  - [ ] `pnpm test:integration` config has no `webServer` field
  - [ ] `pnpm test:e2e` config has no `webServer` field, retries=1
  - [ ] `apps/renderer/playwright.config.ts` no longer exists (replaced by 3 split configs)
  - [ ] `apps/shell/playwright.e2e.config.ts` exists
  - [ ] `.test-results/` in `.gitignore`
  - [ ] `pnpm test:component` still passes 25 tests post-split (no regression)

  **QA Scenarios**:

  ```
  Scenario: All scripts wired and resolve
    Tool: Bash
    Preconditions: T7 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. for s in test:component test:integration test:visual test:visual:update test:e2e test:e2e:debug test:sidecar-integration test:all; do
           pnpm run --silent "$s" --help >/dev/null 2>&1 && echo "$s OK" || echo "$s MISSING"
         done
    Expected Result: All 8 lines end with "OK"
    Evidence: .sisyphus/evidence/task-7-scripts-resolve.txt

  Scenario: Component config picks up exactly 25 tests and passes
    Tool: Bash
    Preconditions: T5 + T7 complete
    Steps:
      1. cd apps/renderer
      2. pnpm exec playwright test --config=playwright.component.config.ts --list 2>&1 | grep -c "›"
      3. pnpm exec playwright test --config=playwright.component.config.ts 2>&1 | tail -3
    Expected Result: line 2 outputs 25; line 3 contains "25 passed"
    Evidence: .sisyphus/evidence/task-7-component-config.txt

  Scenario: Integration and E2E configs have no webServer
    Tool: Bash
    Preconditions: T7 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. grep -c "webServer" apps/renderer/playwright.integration.config.ts
      3. grep -c "webServer" apps/shell/playwright.e2e.config.ts
    Expected Result: Both lines output 0
    Evidence: .sisyphus/evidence/task-7-no-webserver.txt
  ```

  **Evidence to Capture**:
  - [ ] task-7-scripts-resolve.txt
  - [ ] task-7-component-config.txt
  - [ ] task-7-no-webserver.txt

  **Commit**: YES
  - Message: `test(config): split renderer Playwright config into component/integration/visual + add E2E config`
  - Files: `package.json`, `apps/renderer/playwright.component.config.ts`, `apps/renderer/playwright.integration.config.ts`, `apps/renderer/playwright.visual.config.ts`, `apps/shell/playwright.e2e.config.ts`, `.gitignore` (if modified); deletes `apps/renderer/playwright.config.ts`
  - Pre-commit: `pnpm typecheck && pnpm test:component`

- [ ] 8. **Shared sidecar spawn helper (`packages/test-helpers/src/sidecar.ts`)**

  **What to do**:
  - Implement `spawnSidecar(opts?: { extraEnv?: Record<string,string>, cwd?: string, timeoutMs?: number }): Promise<{ proc: ChildProcess, port: number, token: string, baseUrl: string, kill: () => Promise<void> }>`:
    - Spawns `python -m audiomorph_sidecar --port=0` from `apps/sidecar/`
    - Injects env: `AUDIOMORPH_TEST_MODE=1`, plus `getTestEnv()`, plus caller's `extraEnv`
    - Reads first line of stdout, parses as JSON `{event:"listening", port, token}`
    - Throws `SidecarHandshakeTimeout` if no handshake within `timeoutMs` (default 30000)
    - Throws `SidecarHandshakeError` if first line is not valid JSON or missing fields
    - Returns object with helper `kill()` that sends SIGTERM, awaits up to 5s, then SIGKILL
    - Captures all stderr/stdout AFTER handshake into a ring buffer accessible via `proc.stderr` (don't break stream)
    - Asserts token equals `TEST_TOKEN` constant (catches accidental real-mode spawn)
  - Implement `waitForSidecarReady(baseUrl: string, token: string, timeoutMs = 10000): Promise<void>`:
    - Polls `GET ${baseUrl}/health` with `X-Audiomorph-Token` header every 200ms until 200 OK
  - Add tests `packages/test-helpers/src/sidecar.test.ts` (uses real sidecar — runs as part of pnpm test):
    - Spawn + handshake + kill cycle completes in <5s
    - Handshake timeout fires if env var `AUDIOMORPH_TEST_NO_HANDSHAKE=1` set (test hook)
    - Token mismatch throws (set `AUDIOMORPH_TEST_TOKEN_OVERRIDE=wrong` to trigger)
  - Export type definitions

  **Must NOT do**:
  - Hardcode any port number anywhere
  - Use `shell: true` in spawn
  - Block on stderr (must allow stderr to stream concurrently)
  - Leave child processes alive on test failure (must always cleanup)
  - Use `console.log` for any logs — pass-through to caller's stderr

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Process management + handshake protocol with timeout edge cases requires careful async coordination
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T9, T10, T11, T12, T13, T14)
  - **Blocks**: T15, T16, T17
  - **Blocked By**: T2 (HF cache helper for tests that need real engines), T4 (test mode hooks)

  **References**:

  **Pattern References**:
  - `apps/shell/src/sidecar/spawn.ts` - Production sidecar spawn logic; mirror its handshake parsing
  - `apps/shell/src/sidecar/handshake.ts` (or similar) - First-line JSON parsing pattern

  **External References**:
  - Node child_process docs: `https://nodejs.org/api/child_process.html#child_processspawncommand-args-options` - spawn options, stdio piping
  - SIGTERM then SIGKILL pattern: `https://nodejs.org/api/process.html#signal-events` - Graceful shutdown

  **WHY Each Reference Matters**:
  - Production spawn must be the source of truth for handshake format — diverging here means tests don't actually validate prod behavior
  - SIGTERM→wait→SIGKILL is critical because abrupt kill leaves SQLite WAL locks that fail subsequent tests

  **Acceptance Criteria**:

  - [ ] `spawnSidecar()` returns within 5s on healthy boot, including handshake
  - [ ] Returned `port` is a valid integer 1024-65535 (random, never 0)
  - [ ] Returned `token` equals `TEST_TOKEN` constant from T4
  - [ ] `waitForSidecarReady()` succeeds within 2s after handshake
  - [ ] `kill()` releases process within 5s (verifiable: `kill -0 $PID` returns 1)
  - [ ] `vitest run packages/test-helpers/src/sidecar.test.ts` passes all cases

  **QA Scenarios**:

  ```
  Scenario: Healthy spawn + handshake + kill cycle
    Tool: Bash
    Preconditions: T8 complete; sidecar built
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. node --input-type=module -e "
         import {spawnSidecar, waitForSidecarReady} from '@audiomorph/test-helpers/sidecar';
         const t0 = Date.now();
         const s = await spawnSidecar();
         await waitForSidecarReady(s.baseUrl, s.token);
         console.log('port=' + s.port);
         console.log('token-prefix=' + s.token.slice(0,12));
         console.log('elapsed-ms=' + (Date.now()-t0));
         await s.kill();
         console.log('killed=ok');
         " 2>&1 | tee /tmp/spawn.log
      3. grep -q "port=" /tmp/spawn.log && grep -q "killed=ok" /tmp/spawn.log && echo PASS || echo FAIL
    Expected Result: PASS; elapsed <5000ms; port is integer >1024
    Evidence: .sisyphus/evidence/task-8-spawn-cycle.txt

  Scenario: Handshake timeout fires when sidecar hangs
    Tool: Bash
    Preconditions: Test hook AUDIOMORPH_TEST_NO_HANDSHAKE=1 honored
    Steps:
      1. node --input-type=module -e "
         import {spawnSidecar} from '@audiomorph/test-helpers/sidecar';
         try {
           await spawnSidecar({extraEnv: {AUDIOMORPH_TEST_NO_HANDSHAKE: '1'}, timeoutMs: 2000});
           console.log('UNEXPECTED-SUCCESS');
         } catch (e) {
           console.log('caught=' + e.name);
         }
         " 2>&1
    Expected Result: stdout contains "caught=SidecarHandshakeTimeout"
    Evidence: .sisyphus/evidence/task-8-handshake-timeout.txt

  Scenario: Cleanup always releases child even on test throw
    Tool: Bash
    Preconditions: Spawn succeeds; force kill
    Steps:
      1. node --input-type=module -e "
         import {spawnSidecar} from '@audiomorph/test-helpers/sidecar';
         const s = await spawnSidecar();
         const pid = s.proc.pid;
         await s.kill();
         setTimeout(() => {
           try { process.kill(pid, 0); console.log('STILL-ALIVE'); }
           catch { console.log('RELEASED'); }
         }, 500);
         " 2>&1
    Expected Result: stdout contains "RELEASED"
    Evidence: .sisyphus/evidence/task-8-cleanup.txt
  ```

  **Evidence to Capture**:
  - [ ] task-8-spawn-cycle.txt
  - [ ] task-8-handshake-timeout.txt
  - [ ] task-8-cleanup.txt

  **Commit**: YES
  - Message: `test(sidecar): add shared spawn helper with handshake + cleanup`
  - Files: `packages/test-helpers/src/sidecar.ts`, `packages/test-helpers/src/sidecar.test.ts`
  - Pre-commit: `pnpm typecheck && cd packages/test-helpers && pnpm test sidecar`

- [ ] 9. **Electron launch helper (`packages/test-helpers/src/electron.ts`)**

  **What to do**:
  - Implement `launchElectronApp(opts?: { extraEnv?: Record<string,string>, args?: string[], timeoutMs?: number }): Promise<{ app: ElectronApplication, firstWindow: Page, sidecarPort: number, sidecarToken: string, close: () => Promise<void> }>`:
    - Uses Playwright's `_electron.launch({ args: ['.', ...args], env: {...process.env, AUDIOMORPH_TEST_MODE: '1', ...extraEnv} })`
    - Resolves Electron executable path from `apps/shell/node_modules/.bin/electron` (or `out/main/main.js` after build)
    - Waits for first BrowserWindow via `app.firstWindow()` with default timeout 30000ms
    - Extracts sidecar port + token by invoking IPC channel `__audiomorph_test:get-sidecar-info` (NEW test-mode-only IPC handler added to shell main; gated by `AUDIOMORPH_TEST_MODE`)
    - Adds the test-mode IPC handler to `apps/shell/src/main/ipc.ts` (or wherever handlers registered) inside `if (process.env.AUDIOMORPH_TEST_MODE === '1') { ... }` block — marked with `// AUDIOMORPH_TEST_MODE hook` comment
    - Returns `close()` that calls `app.close()` and verifies all child processes exited (including sidecar) within 10s
    - Captures app stdout/stderr via `app.process().stdout` into ring buffer for failure diagnostics
  - Add tests `packages/test-helpers/src/electron.test.ts` (kept lightweight; full E2E in T15):
    - Boot + close cycle <30s
    - First window has title containing "Audiomorph"
    - Sidecar info IPC returns valid port and token
    - Close cleans up sidecar child (verify by checking PID after close)

  **Must NOT do**:
  - Use any IPC channel not explicitly added as test-mode hook (don't reuse production channels for test introspection)
  - Leak Electron processes between tests
  - Skip sidecar cleanup verification (orphaned sidecars break next test)
  - Hardcode Electron path (resolve dynamically)
  - Use absolute paths in args (use `.` for project root)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Electron+Playwright integration with cleanup verification; failure modes are subtle
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T8, T10, T11, T12, T13, T14)
  - **Blocks**: T15, T16, T17, T18
  - **Blocked By**: T4 (test mode hooks in shell)

  **References**:

  **Pattern References**:
  - `apps/shell/src/main/main.ts` - Electron entry; app lifecycle
  - `apps/shell/src/main/ipc.ts` (or equivalent) - Existing IPC handler registration pattern
  - `apps/shell/src/sidecar/spawn.ts` - Where sidecar PID is tracked (needed for cleanup verification)

  **External References**:
  - Playwright Electron docs: `https://playwright.dev/docs/api/class-electron#electron-launch` - launch options, ElectronApplication API
  - Playwright firstWindow: `https://playwright.dev/docs/api/class-electronapplication#electron-application-first-window` - timeout, race conditions

  **WHY Each Reference Matters**:
  - `main.ts` defines app ready event timing — helper must align with this
  - IPC handler pattern must match existing convention so the test-mode hook is consistent
  - Sidecar PID tracking is the only way to verify cleanup; helper needs access to this

  **Acceptance Criteria**:

  - [ ] `launchElectronApp()` returns within 30s on healthy boot
  - [ ] `firstWindow.title()` returns string containing "Audiomorph"
  - [ ] `sidecarPort` is integer >1024; `sidecarToken` equals `TEST_TOKEN`
  - [ ] `close()` returns within 10s
  - [ ] Post-close: sidecar PID no longer alive (`kill -0 $PID` returns 1)
  - [ ] Test-mode IPC handler grep-able via `grep "AUDIOMORPH_TEST_MODE hook" apps/shell/src/main/`

  **QA Scenarios**:

  ```
  Scenario: Electron boots and exposes sidecar info via test-mode IPC
    Tool: Bash
    Preconditions: T9 complete; shell built (`pnpm --filter @audiomorph/shell build`)
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. node --input-type=module -e "
         import {launchElectronApp} from '@audiomorph/test-helpers/electron';
         const t0 = Date.now();
         const a = await launchElectronApp();
         console.log('title=' + await a.firstWindow.title());
         console.log('port=' + a.sidecarPort);
         console.log('token-ok=' + (a.sidecarToken === 'test-token-deterministic-do-not-use-in-prod'));
         console.log('boot-ms=' + (Date.now()-t0));
         await a.close();
         console.log('closed=ok');
         " 2>&1 | tee /tmp/electron-boot.log
      3. grep -q "title=.*Audiomorph" /tmp/electron-boot.log && grep -q "token-ok=true" /tmp/electron-boot.log && grep -q "closed=ok" /tmp/electron-boot.log && echo PASS || echo FAIL
    Expected Result: PASS; boot-ms <30000
    Evidence: .sisyphus/evidence/task-9-electron-boot.txt

  Scenario: Sidecar child is cleaned up after app close
    Tool: Bash
    Preconditions: T9 complete
    Steps:
      1. node --input-type=module -e "
         import {launchElectronApp} from '@audiomorph/test-helpers/electron';
         const a = await launchElectronApp();
         const port = a.sidecarPort;
         await a.close();
         await new Promise(r => setTimeout(r, 1000));
         import('net').then(net => {
           const s = net.connect(port, '127.0.0.1');
           s.on('error', () => console.log('PORT-FREE'));
           s.on('connect', () => { console.log('PORT-STILL-OPEN'); s.destroy(); });
         });
         " 2>&1
    Expected Result: stdout contains "PORT-FREE"
    Evidence: .sisyphus/evidence/task-9-sidecar-cleanup.txt
  ```

  **Evidence to Capture**:
  - [ ] task-9-electron-boot.txt
  - [ ] task-9-sidecar-cleanup.txt

  **Commit**: YES
  - Message: `test(electron): add launch helper + test-mode IPC for introspection`
  - Files: `packages/test-helpers/src/electron.ts`, `packages/test-helpers/src/electron.test.ts`, `apps/shell/src/main/ipc.ts` (or equivalent)
  - Pre-commit: `pnpm typecheck && pnpm --filter @audiomorph/shell build && cd packages/test-helpers && pnpm test electron`

- [ ] 10. **Renderer integration suite — 6 user-journey specs against real sidecar**

  **What to do**:
  - Create `apps/renderer/tests/integration/journey-first-run.spec.ts` — App first launch: model panel empty → trigger model download (use small whisper-tiny only, ~75MB, cached via T2) → status updates streamed via SSE → ready badge appears → assert API key not visible anywhere in DOM
  - Create `apps/renderer/tests/integration/journey-generate.spec.ts` — Configure musicgen prompt → click generate → progress events stream → assert output file path returned → assert file exists on disk → verify duration via ffprobe matches request (5s)
  - Create `apps/renderer/tests/integration/journey-lyrics.spec.ts` — Configure OpenRouter (mocked via local HTTP stub on random port; sidecar configured to use stub URL via `AUDIOMORPH_OPENROUTER_BASE_URL` env) → enter song theme → request lyrics → assert response rendered → assert API key field shows masked value never raw
  - Create `apps/renderer/tests/integration/journey-models.spec.ts` — Open model panel → list models → trigger re-download (cached, instant) → assert disk usage badge updates → assert delete confirmation flow works (use ephemeral non-required model OR mock filesystem write)
  - Create `apps/renderer/tests/integration/journey-settings.spec.ts` — Open settings → toggle theme (light ⇄ dark) → assert OKLCH token applied → save OpenRouter key → reload page → assert key persists masked → assert key never in `window.localStorage`, `window.sessionStorage`, or any Zustand serialized state (check via `window.__ZUSTAND_DEVTOOLS__` if exposed, else by inspecting all `localStorage.getItem` keys)
  - Create `apps/renderer/tests/integration/journey-diagnostics.spec.ts` — Open diagnostics panel → assert live sidecar port shown → assert log stream visible → trigger generate operation → assert log entries appear → assert no sensitive data (token, key) appears in log entries
  - Common pattern in each spec: `test.beforeAll` calls `spawnSidecar()` from T8, serves static export via Playwright's `webServer`-equivalent in test (spawn `bun x serve@latest out -l 0` and capture port), navigates Playwright page with `window.__AUDIOMORPH_API_BASE__` injected via `addInitScript`, `test.afterAll` calls `sidecar.kill()`
  - Each spec MUST: assert no console errors (`page.on('pageerror')`), assert no failed network requests (4xx/5xx other than expected), inject scrubber on test failure output

  **Must NOT do**:
  - Use `page.waitForTimeout()` — use `waitForResponse`, `waitForSelector`, `waitForFunction`
  - Mock the sidecar (use real spawned sidecar from T8)
  - Use real OpenRouter API (always use local stub)
  - Skip the API key leakage assertions (mandatory in every spec that touches settings/keys)
  - Hardcode port 3000 anywhere
  - Use `localStorage.clear()` between tests (verify clean state via assertion instead)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 6 specs touching real sidecar, async streaming, security assertions, and ephemeral resource management
  - **Skills**: [`playwright`]
    - `playwright`: Browser automation patterns, wait strategies, network mocking, fixtures

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T8, T9, T11, T12, T13, T14)
  - **Blocks**: T20, T21 (CI workflows reference these tests)
  - **Blocked By**: T6 (fixtures), T7 (integration config), T8 (sidecar helper)

  **References**:

  **Pattern References**:
  - `apps/renderer/tests/component/*.spec.ts` (post-T5 location) - Existing test patterns for selectors, fixtures import
  - `apps/renderer/src/app/(routes)/page.tsx` - Main generate page; selectors for prompt input, generate button
  - `apps/renderer/src/app/(routes)/models/page.tsx` - Model panel page
  - `apps/renderer/src/app/(routes)/settings/page.tsx` - Settings page; OpenRouter field selector
  - `apps/renderer/src/app/(routes)/diagnostics/page.tsx` - Diagnostics panel
  - `apps/renderer/src/lib/api-client.ts` (or equivalent) - HTTP client; route map

  **API/Type References**:
  - `apps/sidecar/src/routes/*.py` - Sidecar endpoint shapes; what to expect in responses

  **Test References**:
  - `apps/renderer/tests/component/settings.spec.ts` (or similar) - Mocked settings test; mirror flow but with real backend

  **External References**:
  - OpenRouter API shape: `https://openrouter.ai/docs/quickstart` - Chat completion request/response shape (for stub)
  - SSE in Playwright: `https://playwright.dev/docs/api/class-page#page-wait-for-response` - Streaming response handling

  **WHY Each Reference Matters**:
  - Component tests already worked out selector patterns — copy those, only swap mock-IPC for real backend
  - Page routes define the exact DOM structure to assert against
  - OpenRouter doc shapes the stub's response — divergence breaks lyrics spec

  **Acceptance Criteria**:

  - [ ] All 6 spec files exist at `apps/renderer/tests/integration/journey-*.spec.ts`
  - [ ] `pnpm test:integration` runs all 6 specs without `webServer` (each spec manages its own services)
  - [ ] All specs pass with HF models cached (via T2 helper)
  - [ ] Zero `page.waitForTimeout` occurrences (`grep -r waitForTimeout apps/renderer/tests/integration/ | wc -l` returns 0)
  - [ ] Every spec asserts API key never appears raw in DOM (`grep -c "api.*key.*masked\|never.*raw\|toContainText.*\\*\\*\\*\\*" apps/renderer/tests/integration/journey-*.spec.ts` ≥6)
  - [ ] Every spec asserts no console errors (`page.on('pageerror')` listener present)
  - [ ] Total runtime <5min on warm cache

  **QA Scenarios**:

  ```
  Scenario: All 6 integration specs run and pass against real sidecar
    Tool: Bash
    Preconditions: T10 complete; HF cache warm; sidecar built
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. time pnpm test:integration 2>&1 | tee /tmp/integration.log
      3. grep -E "(passed|failed)" /tmp/integration.log | tail -3
    Expected Result: tail shows "6 passed" (one per spec, or higher if specs have multiple test cases); real time <5min
    Evidence: .sisyphus/evidence/task-10-integration-run.txt

  Scenario: API key leakage assertions actually catch leaks (negative test)
    Tool: Bash
    Preconditions: T10 complete
    Steps:
      1. cd apps/renderer
      2. # Temporarily seed leak: edit test to remove masking assertion stub
      3. # Run with intentional leak via test hook: AUDIOMORPH_TEST_LEAK_KEY=1
      4. AUDIOMORPH_TEST_LEAK_KEY=1 pnpm exec playwright test --config=playwright.integration.config.ts tests/integration/journey-settings.spec.ts 2>&1 | grep -iE "(fail|leak|raw)"
    Expected Result: Test FAILS with leak assertion error (proves assertion is wired)
    Evidence: .sisyphus/evidence/task-10-leak-detection.txt

  Scenario: No flakiness across 3 consecutive runs
    Tool: Bash
    Preconditions: T10 complete
    Steps:
      1. for i in 1 2 3; do
           pnpm test:integration 2>&1 | grep -E "passed|failed" | tail -1 > /tmp/run-$i.txt
         done
      2. cat /tmp/run-{1,2,3}.txt
    Expected Result: All 3 lines show identical "N passed" (no failures, no flakes)
    Evidence: .sisyphus/evidence/task-10-stability.txt
  ```

  **Evidence to Capture**:
  - [ ] task-10-integration-run.txt
  - [ ] task-10-leak-detection.txt
  - [ ] task-10-stability.txt

  **Commit**: YES
  - Message: `test(integration): add 6 renderer journey specs against real sidecar`
  - Files: `apps/renderer/tests/integration/journey-*.spec.ts` (6 files), `apps/renderer/tests/integration/_setup.ts` (shared spawn/teardown)
  - Pre-commit: `pnpm typecheck && pnpm test:integration`

- [ ] 11. **Sidecar pytest integration suite — 7 files exercising real SQLite + stubbed engines**

  **What to do**:
  - Create `apps/sidecar/tests/integration/__init__.py`
  - Create `apps/sidecar/tests/integration/conftest.py`:
    - `@pytest.fixture` `sqlite_db` → creates tempfile DB, runs migrations, yields path, deletes after
    - `@pytest.fixture` `app_client` → constructs FastAPI/aiohttp test client with `AUDIOMORPH_TEST_MODE=1`, fixed token, in-memory vault, the temp SQLite, stubbed engine registry
    - `@pytest.fixture` `auth_headers` → returns `{"X-Audiomorph-Token": TEST_TOKEN}` dict (TEST_TOKEN mirrored from `packages/test-helpers/src/test-mode.ts` constant)
    - `@pytest.fixture` `openrouter_stub` → starts local aiohttp server on random port returning fixture from `packages/test-helpers/fixtures/openrouter/chat-response.json`; sets `AUDIOMORPH_OPENROUTER_BASE_URL` env
    - `@pytest.fixture` `stub_musicgen` → monkeypatches `musicgen.generate()` to write `packages/test-helpers/fixtures/audio/short.wav` to output path and return metadata (no real model)
    - `@pytest.fixture` `stub_whisper` → monkeypatches `whisper.transcribe()` to return `{"text": "hello this is a test recording", "segments": [...]}` (no real model)
  - Create 7 test files (one per integration concern):
    1. `test_auth_flow.py` — token validation: missing header → 401; wrong token → 401; correct token → 200; verify `X-Audiomorph-Token` is the only accepted header name (not `Authorization`)
    2. `test_generation_endpoint.py` — POST `/generate` with stub_musicgen → assert 200, response shape, output file path written, SQLite row inserted in `generations` table; concurrent requests (3 parallel) all succeed with distinct IDs
    3. `test_transcription_endpoint.py` — POST `/transcribe` with stub_whisper + speech-3s.wav fixture → assert 200, text field present, segments array shape; assert SQLite row in `transcriptions` table
    4. `test_models_endpoint.py` — GET `/models` lists known models from manifest; POST `/models/download` with whisper-tiny → SSE stream of progress events; cancellation mid-download cleanly stops
    5. `test_lyrics_endpoint.py` — POST `/lyrics` with openrouter_stub → assert response forwarded; assert OpenRouter key NEVER logged (capture log output, scan with scrubber); error from stub → 502 with sanitized error message
    6. `test_vault_isolation.py` — verify `AUDIOMORPH_TEST_MODE=1` causes vault to use dict not keyring; verify keyring is never touched (mock keyring module; assert zero calls); verify shutdown clears in-memory vault
    7. `test_telemetry_disabled.py` — verify in test mode all telemetry endpoints are no-ops; verify no outbound HTTPS connections made (mock socket, assert zero connections to non-localhost)
  - Wire JUnit output to `.test-results/sidecar-integration.xml` via `--junitxml` flag (already in T7 script)
  - Add `apps/sidecar/pytest.ini` (or extend existing) with marker `integration` so unit tests don't run when targeting `tests/integration/`

  **Must NOT do**:
  - Touch real keyring (must mock and assert zero calls)
  - Make real network calls to OpenRouter (always use stub)
  - Load real HF models (always use stubs)
  - Use `time.sleep()` for synchronization — use proper await/poll
  - Share SQLite DB across tests (tempfile per test)
  - Use `Authorization: Bearer` header anywhere (must be `X-Audiomorph-Token`)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 7 test files covering security boundaries (auth, vault, telemetry) and async streaming with strict isolation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T8, T9, T10, T12, T13, T14)
  - **Blocks**: T20, T21 (CI workflows reference this)
  - **Blocked By**: T4 (test mode hooks), T6 (fixtures)

  **References**:

  **Pattern References**:
  - `apps/sidecar/tests/*.py` - Existing 53 unit tests; mirror fixture style and assertion patterns
  - `apps/sidecar/src/app.py` (or `main.py`) - App factory / route registration
  - `apps/sidecar/src/db/migrations.py` - SQLite migration runner
  - `apps/sidecar/src/auth.py` - Token validation logic
  - `apps/sidecar/src/vault.py` - Vault interface
  - `apps/sidecar/src/routes/generate.py` - Generation endpoint
  - `apps/sidecar/src/routes/lyrics.py` - OpenRouter forwarding

  **API/Type References**:
  - `apps/sidecar/src/models/dto.py` - Response shape definitions

  **External References**:
  - pytest fixtures: `https://docs.pytest.org/en/stable/explanation/fixtures.html` - Scope, parametrize
  - aiohttp test client: `https://docs.aiohttp.org/en/stable/testing.html` - If aiohttp; or FastAPI TestClient

  **WHY Each Reference Matters**:
  - Unit tests already established fixture style — diverging causes review friction
  - Auth + vault are the security perimeter — tests MUST exercise the exact validation paths used in prod
  - Migration runner is needed in `sqlite_db` fixture to produce a real schema

  **Acceptance Criteria**:

  - [ ] 7 test files exist under `apps/sidecar/tests/integration/`
  - [ ] `pnpm test:sidecar-integration` runs all 7 files and writes JUnit XML to `.test-results/sidecar-integration.xml`
  - [ ] All 7 files pass with HF stubs (no real models)
  - [ ] `grep -r "Authorization: Bearer\|Authorization:.bearer" apps/sidecar/tests/integration/ | wc -l` returns 0
  - [ ] `grep -r "openrouter.ai" apps/sidecar/tests/integration/ | wc -l` returns 0 (stub only)
  - [ ] Existing 53 unit tests still pass (no regression)
  - [ ] Total runtime <8min

  **QA Scenarios**:

  ```
  Scenario: All 7 integration files pass with strict isolation
    Tool: Bash
    Preconditions: T11 complete; T4 hooks landed
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. time pnpm test:sidecar-integration 2>&1 | tee /tmp/sidecar-it.log
      3. grep -E "passed|failed" /tmp/sidecar-it.log | tail -3
      4. test -f .test-results/sidecar-integration.xml && echo "JUNIT-WRITTEN"
    Expected Result: tail shows all passed; JUNIT-WRITTEN printed; real time <8min
    Evidence: .sisyphus/evidence/task-11-sidecar-it-run.txt

  Scenario: Auth header constraint enforced (X-Audiomorph-Token only)
    Tool: Bash
    Preconditions: T11 complete; sidecar running via spawnSidecar
    Steps:
      1. node --input-type=module -e "
         import {spawnSidecar} from '@audiomorph/test-helpers/sidecar';
         const s = await spawnSidecar();
         const r1 = await fetch(s.baseUrl + '/health', {headers: {'Authorization': 'Bearer ' + s.token}});
         const r2 = await fetch(s.baseUrl + '/health', {headers: {'X-Audiomorph-Token': s.token}});
         console.log('bearer-status=' + r1.status);
         console.log('xaudio-status=' + r2.status);
         await s.kill();
         " 2>&1
    Expected Result: bearer-status=401; xaudio-status=200
    Evidence: .sisyphus/evidence/task-11-auth-header-strict.txt

  Scenario: No real keyring or network access in tests
    Tool: Bash
    Preconditions: T11 complete
    Steps:
      1. cd apps/sidecar
      2. pytest tests/integration/test_vault_isolation.py tests/integration/test_telemetry_disabled.py -v 2>&1 | tail -20
    Expected Result: Both tests pass; assertions about zero keyring/network calls verified
    Evidence: .sisyphus/evidence/task-11-isolation-verified.txt
  ```

  **Evidence to Capture**:
  - [ ] task-11-sidecar-it-run.txt
  - [ ] task-11-auth-header-strict.txt
  - [ ] task-11-isolation-verified.txt

  **Commit**: YES
  - Message: `test(sidecar): add 7-file pytest integration suite with real SQLite + stubs`
  - Files: `apps/sidecar/tests/integration/**`, `apps/sidecar/pytest.ini` (if modified)
  - Pre-commit: `pnpm test:sidecar-integration && cd apps/sidecar && pytest tests/ -q`

- [ ] 12. **Visual regression suite — all routes × {light,dark} × per-platform baselines**

  **What to do**:
  - Create `apps/renderer/tests/visual/routes.spec.ts`:
    - Discover all routes from `apps/renderer/src/app/(routes)/**/page.tsx` (enumerate at test-collection time)
    - For each route × each theme (`light`, `dark`):
      - Navigate to route via static export (component config webServer)
      - Apply theme via `data-theme` attribute or test hook
      - Wait for `networkidle` AND for a known stable selector (e.g., `[data-testid="route-ready"]` — add this to each route's top-level layout as a one-line `data-testid` if not present; this is a test-mode hook marked accordingly)
      - Mask known volatile regions: timestamps, version strings, random IDs (`mask: [page.locator('[data-volatile]')]`)
      - `expect(page).toHaveScreenshot(\`\${route-slug}-\${theme}.png\`, { maxDiffPixelRatio: 0.01, fullPage: true })`
  - Configure `apps/renderer/playwright.visual.config.ts` (created in T7) with:
    - `snapshotPathTemplate: '__snapshots__/{platform}/{testFilePath}/{arg}{ext}'` so darwin/win32/linux baselines are isolated
    - `expect.toHaveScreenshot.threshold: 0.2`, `maxDiffPixelRatio: 0.01`, `animations: 'disabled'`, `caret: 'hide'`
    - `use.viewport: { width: 1440, height: 900 }` (fixed for determinism)
  - Add `apps/renderer/tests/visual/__snapshots__/.gitkeep` (empty subdirs created on first run per platform)
  - Document baseline update workflow in `apps/renderer/tests/visual/README.md`:
    - Local: `pnpm test:visual:update` on each platform
    - CI: separate workflow `update-visual-baselines.yml` (T23) commits new baselines

  **Must NOT do**:
  - Share baselines across platforms (each OS has separate `__snapshots__/{darwin|win32|linux}/` dir)
  - Auto-update baselines on `main` push (only via dedicated workflow)
  - Use full-DOM screenshots without masking volatile regions
  - Allow `maxDiffPixelRatio > 0.01` (catches subtle regressions)
  - Allow animations during screenshots (`animations: 'disabled'` mandatory)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Visual regression requires understanding theme system, masking strategy, OS font rendering differences
  - **Skills**: [`playwright`]
    - `playwright`: Screenshot API, masking, snapshot path templates

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T8, T9, T10, T11, T13, T14)
  - **Blocks**: T21, T23
  - **Blocked By**: T7 (visual config)

  **References**:

  **Pattern References**:
  - `apps/renderer/src/app/(routes)/**/page.tsx` - All route files; source-of-truth for route enumeration
  - `apps/renderer/src/app/layout.tsx` - Theme application; `data-theme` attribute location
  - `apps/renderer/src/components/theme-provider.tsx` (or similar) - Theme switching mechanism

  **External References**:
  - Playwright visual comparisons: `https://playwright.dev/docs/test-snapshots` - toHaveScreenshot API, masking, thresholds
  - Snapshot path template: `https://playwright.dev/docs/api/class-testconfig#test-config-snapshot-path-template` - `{platform}` token

  **WHY Each Reference Matters**:
  - Route enumeration must be accurate — missing a route means missing coverage; extra route means failed test
  - Theme provider determines HOW to toggle — wrong mechanism means tests don't actually exercise dark mode
  - `{platform}` token in snapshot path is the key to per-OS baseline isolation

  **Acceptance Criteria**:

  - [ ] `apps/renderer/tests/visual/routes.spec.ts` exists
  - [ ] First run with `--update-snapshots` produces baselines under `__snapshots__/{darwin|win32|linux}/routes.spec.ts/`
  - [ ] Subsequent runs without changes pass with 0 diff
  - [ ] Modifying a single OKLCH token in renderer source causes ≥1 visual test to fail (verify regression detection works)
  - [ ] Snapshot count = (#routes × 2 themes) per platform
  - [ ] README documents update workflow
  - [ ] Total runtime <10min

  **QA Scenarios**:

  ```
  Scenario: Visual baselines generated and stable across consecutive runs
    Tool: Bash
    Preconditions: T12 complete; component static export built (`pnpm --filter @audiomorph/renderer build`)
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. pnpm test:visual:update 2>&1 | tee /tmp/visual-bootstrap.log
      3. PLATFORM=$(node -e "console.log({darwin:'darwin',win32:'win32',linux:'linux'}[process.platform])")
      4. find apps/renderer/tests/visual/__snapshots__/$PLATFORM -name "*.png" | wc -l > /tmp/baseline-count.txt
      5. pnpm test:visual 2>&1 | tail -5
    Expected Result: baseline-count.txt > 0 (at least 1 PNG per route×theme); second run shows all passed with 0 diff
    Evidence: .sisyphus/evidence/task-12-visual-baselines.txt

  Scenario: Visual regression actually catches a real change
    Tool: Bash
    Preconditions: T12 complete; baselines exist
    Steps:
      1. cd apps/renderer
      2. # Inject a 1-character color change in a global OKLCH token
      3. ORIGINAL=$(grep -m1 -oE "oklch\([^)]+\)" src/app/globals.css | head -1)
      4. sed -i.bak "0,/${ORIGINAL//\//\\/}/s//oklch(0.5 0.1 200)/" src/app/globals.css
      5. pnpm exec playwright test --config=playwright.visual.config.ts 2>&1 | tail -5 | tee /tmp/visual-regression.log
      6. mv src/app/globals.css.bak src/app/globals.css  # restore
      7. grep -E "(failed|diff)" /tmp/visual-regression.log | head -3
    Expected Result: At least 1 test failed with pixel diff (proves regression detection works)
    Evidence: .sisyphus/evidence/task-12-regression-detection.txt
  ```

  **Evidence to Capture**:
  - [ ] task-12-visual-baselines.txt
  - [ ] task-12-regression-detection.txt

  **Commit**: YES
  - Message: `test(visual): add visual regression suite for all routes × themes`
  - Files: `apps/renderer/tests/visual/routes.spec.ts`, `apps/renderer/tests/visual/README.md`, `apps/renderer/tests/visual/__snapshots__/.gitkeep`, `apps/renderer/playwright.visual.config.ts` (config polish if needed); `apps/renderer/src/app/(routes)/**/layout.tsx` adds `data-testid="route-ready"` test-mode hooks
  - Pre-commit: `pnpm test:visual:update && pnpm test:visual`

- [ ] 13. **Component config update + ensure 25 existing tests pass under new split config**

  **What to do**:
  - Verify `apps/renderer/playwright.component.config.ts` (created in T7) picks up exactly the 10 spec files / 25 tests moved in T5
  - If any tests fail due to config differences:
    - Adjust `testMatch` glob if needed (`tests/component/**/*.spec.ts`)
    - Ensure `webServer` still works (`bun x serve@latest out -l 3000` or equivalent)
    - Update `fixtures` import paths if T5 left any broken (most fixtures stay at `tests/fixtures/`, but moved specs may need `../fixtures` → `../../fixtures`)
  - Add a CI guard test `apps/renderer/tests/component/_guard.spec.ts`:
    - Asserts `process.env.AUDIOMORPH_TEST_MODE` is unset OR `'1'` (never other values)
    - Asserts `window.__AUDIOMORPH_IPC__` injection pattern still works
    - Asserts no `_setup.ts` from integration leaks in
  - Verify pnpm test:component runs in <2min
  - Update root `package.json` lint-staged or pre-commit (if any) to include `test:component` in fast tier

  **Must NOT do**:
  - Modify any of the 25 existing tests' logic
  - Combine component and integration into one config
  - Add new mocks (component layer keeps existing mocks)
  - Lower the maxDiffPixelRatio or other thresholds
  - Remove the existing webServer pattern

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Config sanity-check and minor import fixes; low risk
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T8, T9, T10, T11, T12, T14)
  - **Blocks**: T20
  - **Blocked By**: T5 (specs moved), T7 (configs split)

  **References**:

  **Pattern References**:
  - `apps/renderer/playwright.component.config.ts` - The split config from T7
  - `apps/renderer/tests/component/*.spec.ts` - The 10 moved specs from T5
  - `apps/renderer/tests/fixtures/` (or wherever fixtures live) - Shared fixture path

  **External References**:
  - Playwright testMatch: `https://playwright.dev/docs/api/class-testconfig#test-config-test-match` - Glob patterns

  **WHY Each Reference Matters**:
  - Component config is the gating mechanism for the 25 existing tests — broken config means broken CI
  - The moved spec files may have relative imports that broke during move; this task fixes those

  **Acceptance Criteria**:

  - [ ] `pnpm test:component` lists exactly 25 tests
  - [ ] `pnpm test:component` passes all 25 with 0 failures
  - [ ] `_guard.spec.ts` asserts environment cleanliness
  - [ ] Runtime <2min
  - [ ] No new mocking introduced (`git diff apps/renderer/tests/component/` shows only path/config fixes)

  **QA Scenarios**:

  ```
  Scenario: Component config runs exactly 25 tests, all pass, under 2min
    Tool: Bash
    Preconditions: T13 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. time pnpm test:component 2>&1 | tee /tmp/component.log
      3. grep -c "›" /tmp/component.log  # rough test list count
      4. grep -E "passed|failed" /tmp/component.log | tail -3
    Expected Result: Test count includes 25 + guard test = 26; tail shows "26 passed"; real time <2min
    Evidence: .sisyphus/evidence/task-13-component-run.txt

  Scenario: Guard test catches accidental env contamination
    Tool: Bash
    Preconditions: T13 complete
    Steps:
      1. cd apps/renderer
      2. AUDIOMORPH_TEST_MODE=wrong pnpm exec playwright test --config=playwright.component.config.ts tests/component/_guard.spec.ts 2>&1 | tail -5
    Expected Result: Guard test FAILS (proves it catches invalid env values)
    Evidence: .sisyphus/evidence/task-13-guard-catches-bad-env.txt
  ```

  **Evidence to Capture**:
  - [ ] task-13-component-run.txt
  - [ ] task-13-guard-catches-bad-env.txt

  **Commit**: YES
  - Message: `test(component): add CI guard spec and verify 25 tests under split config`
  - Files: `apps/renderer/tests/component/_guard.spec.ts`, any minor import fixes in moved specs
  - Pre-commit: `pnpm test:component`

- [ ] 14. **Electron E2E suite — 6 specs launching real Electron + sidecar + real engines**

  **What to do**:
  - Create `apps/shell/tests/e2e/_setup.ts` exporting `launchAudiomorph()` that uses helper from T9:
    - Spawns real Electron via `_electron.launch({ args: ['.'], env: { AUDIOMORPH_TEST_MODE: '1', AUDIOMORPH_HF_CACHE: cachePath } })`
    - Waits for first window
    - Retrieves sidecar info via test-mode IPC channel `__audiomorph_test:get-sidecar-info`
    - Returns `{ app, window, sidecar: { port, token, baseUrl } }`
    - Provides `teardown()` that closes window, kills sidecar, deletes temp dirs
  - Create 6 E2E spec files under `apps/shell/tests/e2e/`:
    1. `e2e-cold-start.spec.ts` — Launch app from cold state; verify main window appears within 15s; verify sidecar handshake completes; verify all routes navigable; verify no error dialogs
    2. `e2e-generate-real-engine.spec.ts` — Navigate to Generate route; enter prompt "happy piano melody"; set duration=5s; click Generate; wait for completion (≤90s); verify output WAV file written to expected path; verify SQLite row created; verify audio player loads file
    3. `e2e-transcribe-real-engine.spec.ts` — Navigate to Transcribe route; upload `packages/test-helpers/fixtures/audio/speech-3s.wav`; click Transcribe; wait for completion (≤60s); verify transcript text appears in UI; verify segments rendered
    4. `e2e-byok-openrouter.spec.ts` — Navigate to Settings; paste fake key `sk-or-v1-PLANTED-FAKE-TEST-TOKEN`; click Save; verify key field shows masked value (•••• or similar); reload app; verify key still present (vault persisted); verify raw key NOT in DOM (`page.content()` doesn't contain the planted string)
    5. `e2e-models-management.spec.ts` — Navigate to Models route; verify musicgen-small and whisper-tiny listed as "downloaded" (cache pre-warmed); click Download on a third uncached model variant; verify SSE progress events stream; cancel mid-download; verify partial file cleaned up
    6. `e2e-no-network-leak.spec.ts` — Launch app; navigate every route; perform generate + transcribe; capture all outbound HTTP via Playwright `page.route('**/*')` and a sidecar-level network mock; assert ZERO requests to non-localhost (except OpenRouter stub URL if used); assert ZERO requests to telemetry/update domains; assert ZERO requests with `Authorization: Bearer`
  - Wire JUnit output to `.test-results/e2e.xml`
  - Cap individual test timeout at 120s; total suite cap 25min
  - `retries: 1` only (per constraint)

  **Must NOT do**:
  - Mock the sidecar or engines (this is the REAL stack test)
  - Use `page.waitForTimeout()` (use proper wait conditions: `waitForSelector`, `waitForResponse`, `waitForEvent`)
  - Hardcode ports (always read from test-mode IPC)
  - Allow retries > 1
  - Use OpenRouter live API (always planted fake token)
  - Skip the network-leak spec — it's the security perimeter check
  - Run on macOS in PR tier (nightly only per cost guard)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Real-engine E2E with strict timing, network assertions, and IPC handshakes; debugging requires deep system understanding
  - **Skills**: [`playwright`]
    - `playwright`: `_electron` API, page.route, network interception

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T15, T16, T17, T18, T19)
  - **Blocks**: T22 (nightly CI workflow)
  - **Blocked By**: T9 (electron launch helper), T2 (HF cache helper)

  **References**:

  **Pattern References**:
  - `apps/shell/src/main/index.ts` - App entry; window creation
  - `apps/shell/src/main/ipc.ts` - IPC channels (test-mode handler added in T9)
  - `apps/renderer/src/lib/api-base.ts` - How renderer discovers sidecar URL
  - `apps/shell/src/sidecar/spawn.ts` - Sidecar spawn lifecycle

  **API/Type References**:
  - `packages/test-helpers/src/electron.ts` (from T9) - `launchAudiomorph()` signature
  - `packages/test-helpers/src/test-mode.ts` (from T4) - `TEST_TOKEN`, sentinel constant

  **External References**:
  - Playwright Electron: `https://playwright.dev/docs/api/class-electron` - `_electron.launch`, `firstWindow`
  - Page network interception: `https://playwright.dev/docs/network` - `page.route`, request capture

  **WHY Each Reference Matters**:
  - Real-engine timing budgets depend on actual model warm-up + inference; references inform the 90s/60s waits
  - Network-leak spec depends on Playwright's `page.route` for renderer-side; sidecar-side requires socket-level mock from T11 pattern

  **Acceptance Criteria**:

  - [ ] 6 E2E specs exist under `apps/shell/tests/e2e/`
  - [ ] `pnpm test:e2e` runs all 6 and writes `.test-results/e2e.xml`
  - [ ] Cold-start completes <15s
  - [ ] Generate completes <90s with real musicgen
  - [ ] Transcribe completes <60s with real whisper
  - [ ] BYOK spec confirms raw key NEVER in DOM
  - [ ] Network-leak spec passes with ZERO non-localhost requests
  - [ ] Total suite runtime <25min on warm cache
  - [ ] `grep -rn "waitForTimeout\|setTimeout.*[0-9]" apps/shell/tests/e2e/ | wc -l` returns 0

  **QA Scenarios**:

  ```
  Scenario: Full E2E suite passes with real engines on warm cache
    Tool: Bash
    Preconditions: T14 complete; HF cache warmed via test-helpers script; AUDIOMORPH_TEST_MODE=1
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. node packages/test-helpers/scripts/warm-hf-cache.mjs  # ensures models present
      3. time pnpm test:e2e 2>&1 | tee /tmp/e2e.log
      4. grep -E "passed|failed" /tmp/e2e.log | tail -3
      5. test -f .test-results/e2e.xml && echo "JUNIT-OK"
    Expected Result: 6 passed, 0 failed; JUNIT-OK; real time <25min
    Evidence: .sisyphus/evidence/task-14-e2e-suite-pass.txt

  Scenario: BYOK key never appears in renderer DOM
    Tool: Bash
    Preconditions: T14 complete; planted token = sk-or-v1-PLANTED-FAKE-TEST-TOKEN
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. pnpm exec playwright test --config=apps/shell/playwright.e2e.config.ts apps/shell/tests/e2e/e2e-byok-openrouter.spec.ts 2>&1 | tail -10
    Expected Result: byok spec passes; assertions about masking + DOM absence pass
    Evidence: .sisyphus/evidence/task-14-byok-no-leak.txt

  Scenario: No network leak to non-localhost domains
    Tool: Bash
    Preconditions: T14 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. pnpm exec playwright test --config=apps/shell/playwright.e2e.config.ts apps/shell/tests/e2e/e2e-no-network-leak.spec.ts 2>&1 | tail -10
    Expected Result: network-leak spec passes; zero outbound non-localhost requests captured
    Evidence: .sisyphus/evidence/task-14-network-clean.txt
  ```

  **Evidence to Capture**:
  - [ ] task-14-e2e-suite-pass.txt
  - [ ] task-14-byok-no-leak.txt
  - [ ] task-14-network-clean.txt

  **Commit**: YES
  - Message: `test(e2e): add 6 Electron E2E specs against real sidecar and engines`
  - Files: `apps/shell/tests/e2e/**`, `apps/shell/playwright.e2e.config.ts` (final polish if needed)
  - Pre-commit: `pnpm typecheck && pnpm test:e2e`

- [ ] 15. **Scrubber CI integration — fail builds on secrets in test output/evidence**

  **What to do**:
  - Create `scripts/scrub-test-output.mjs` (root):
    - Walks `.test-results/`, `.sisyphus/evidence/`, `playwright-report/`, `test-results/`
    - Pipes each text file through `packages/test-helpers/src/scrubber` (from T3)
    - For each match found, prints `FILE:LINE:PATTERN` and exits non-zero
    - For binary files (PNGs, MP4s), uses metadata-only check (EXIF, filename only)
    - Pattern list extends T3's: `sk-or-v1-[A-Za-z0-9-_]{20,}`, `hf_[A-Za-z0-9]{30,}`, generic `Bearer [A-Za-z0-9-._~+/]{20,}={0,2}`, keyring lookups, planted-token marker FROM the test (whitelist `PLANTED-FAKE-TEST-TOKEN` since it's the deliberate test string)
  - Add root npm script `"scrub-secrets": "node scripts/scrub-test-output.mjs"`
  - Add a positive-control test in `packages/test-helpers/scrubber.test.ts`:
    - Plants a real-shaped fake token in a temp file
    - Runs scrubber
    - Asserts scrubber detects and fails

  **Must NOT do**:
  - Whitelist real-looking tokens (only the explicit PLANTED-FAKE-TEST-TOKEN marker)
  - Skip binary files entirely (must at least check filenames/metadata)
  - Allow soft-fail mode in CI (always exit non-zero on detection)
  - Modify the scrubber library itself (this task is integration only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Glue script integrating existing scrubber lib with file walk and CI exit codes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T16, T17, T18, T19)
  - **Blocks**: T20, T21, T22 (all CI workflows call scrub)
  - **Blocked By**: T3 (scrubber lib)

  **References**:

  **Pattern References**:
  - `packages/test-helpers/src/scrubber.ts` - Core scrubber (from T3)
  - `packages/test-helpers/src/scrubber.test.ts` - Existing unit tests

  **External References**:
  - Node fs.promises walk: `https://nodejs.org/api/fs.html#fspromisesreaddirpath-options` - `withFileTypes`, recursive
  - process.exit codes: 0=clean, 1=secrets found, 2=script error

  **WHY Each Reference Matters**:
  - Scrubber lib does pattern matching; this script wraps it with file walking and CI integration
  - Exit codes are how CI knows to fail the job

  **Acceptance Criteria**:

  - [ ] `scripts/scrub-test-output.mjs` exists and is executable
  - [ ] Running on clean `.test-results/` exits 0
  - [ ] Planting fake `sk-or-v1-abc123def456ghi789jkl012` in a temp file under `.test-results/` → script exits 1 with file:line
  - [ ] Planted PLANTED-FAKE-TEST-TOKEN string is whitelisted (does NOT trigger fail)
  - [ ] Positive-control test in scrubber.test.ts passes

  **QA Scenarios**:

  ```
  Scenario: Scrubber detects planted real-shape secret and fails
    Tool: Bash
    Preconditions: T15 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. mkdir -p .test-results/_qa && echo "leaked: sk-or-v1-abc123def456ghi789jkl012mno" > .test-results/_qa/leak.txt
      3. node scripts/scrub-test-output.mjs; CODE=$?
      4. rm -rf .test-results/_qa
      5. echo "exit-code=$CODE"
    Expected Result: exit-code=1
    Evidence: .sisyphus/evidence/task-15-scrub-detects.txt

  Scenario: Whitelisted planted-fake-test-token does not trigger fail
    Tool: Bash
    Preconditions: T15 complete
    Steps:
      1. mkdir -p .test-results/_qa && echo "test data: sk-or-v1-PLANTED-FAKE-TEST-TOKEN" > .test-results/_qa/test.txt
      2. node scripts/scrub-test-output.mjs; CODE=$?
      3. rm -rf .test-results/_qa
      4. echo "exit-code=$CODE"
    Expected Result: exit-code=0
    Evidence: .sisyphus/evidence/task-15-whitelist-ok.txt
  ```

  **Evidence to Capture**:
  - [ ] task-15-scrub-detects.txt
  - [ ] task-15-whitelist-ok.txt

  **Commit**: YES
  - Message: `test(security): add scrubber CI integration script with positive-control`
  - Files: `scripts/scrub-test-output.mjs`, `package.json` (script entry), `packages/test-helpers/src/scrubber.test.ts` (positive-control case)
  - Pre-commit: `pnpm scrub-secrets && pnpm --filter @audiomorph/test-helpers test`

- [ ] 16. **Visual baseline directory bootstrap + PR-diff comment bot**

  **What to do**:
  - Create `scripts/post-visual-diff-comment.mjs`:
    - Walks `apps/renderer/tests/visual/__snapshots__/*/test-results/` for any `-diff.png` files
    - If found:
      - Uploads each as workflow artifact (returns artifact URL)
      - Posts a PR comment via `gh api` with thumbnails + links: `| Route | Theme | Baseline | Actual | Diff |`
    - If none: posts/updates a comment "✅ Visual regression: 0 diffs detected"
  - Idempotent: finds existing bot comment by marker `<!-- audiomorph-visual-bot -->` and edits it instead of duplicating
  - Reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_PR_NUMBER` from env (CI-provided)
  - Local mode (no env): prints to stdout instead of posting
  - Add `apps/renderer/tests/visual/__snapshots__/{darwin,win32,linux}/.gitkeep` so per-platform dirs exist before first CI run

  **Must NOT do**:
  - Post comments outside PR context (skip on push-to-main)
  - Hardcode repo or PR number
  - Use any GitHub creds besides `GITHUB_TOKEN`
  - Duplicate comments on each push (always edit existing marker comment)
  - Block CI on comment failure (warn but don't fail; comment is observability, not gate)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: GH API integration script; well-trodden territory
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T17, T18, T19)
  - **Blocks**: T21 (main CI uses this)
  - **Blocked By**: T12 (visual suite produces diffs)

  **References**:

  **Pattern References**:
  - GitHub Actions context env: `https://docs.github.com/en/actions/learn-github-actions/variables` - `GITHUB_*` vars

  **External References**:
  - `gh api` for PR comments: `https://cli.github.com/manual/gh_api` - issues/comments endpoint
  - Workflow artifact upload via @actions/upload-artifact

  **WHY Each Reference Matters**:
  - `gh api` is preferred over raw `fetch` because GH CLI handles auth via env automatically
  - Marker comment pattern is the standard idiom for idempotent bot comments

  **Acceptance Criteria**:

  - [ ] `scripts/post-visual-diff-comment.mjs` exists
  - [ ] Local mode (no GITHUB_TOKEN) prints summary to stdout, exits 0
  - [ ] Per-platform `__snapshots__/{darwin,win32,linux}/.gitkeep` committed
  - [ ] Dry-run with mock diffs prints expected comment shape

  **QA Scenarios**:

  ```
  Scenario: Local mode prints summary without posting
    Tool: Bash
    Preconditions: T16 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. unset GITHUB_TOKEN GITHUB_PR_NUMBER
      3. node scripts/post-visual-diff-comment.mjs 2>&1 | tee /tmp/diff-bot.log
      4. echo "exit=$?"
    Expected Result: Prints "✅ Visual regression: 0 diffs detected" or count summary; exit=0
    Evidence: .sisyphus/evidence/task-16-bot-local-mode.txt

  Scenario: Mock diff triggers comment-shape output
    Tool: Bash
    Preconditions: T16 complete
    Steps:
      1. mkdir -p apps/renderer/tests/visual/__snapshots__/darwin/test-results/routes-spec-ts
      2. echo "fake-png-data" > apps/renderer/tests/visual/__snapshots__/darwin/test-results/routes-spec-ts/home-light-diff.png
      3. node scripts/post-visual-diff-comment.mjs 2>&1 | tee /tmp/diff-bot-mock.log
      4. rm apps/renderer/tests/visual/__snapshots__/darwin/test-results/routes-spec-ts/home-light-diff.png
      5. grep -E "home|diff" /tmp/diff-bot-mock.log | head -3
    Expected Result: Output mentions home-light-diff.png in comment shape
    Evidence: .sisyphus/evidence/task-16-bot-mock-diff.txt
  ```

  **Evidence to Capture**:
  - [ ] task-16-bot-local-mode.txt
  - [ ] task-16-bot-mock-diff.txt

  **Commit**: YES
  - Message: `test(visual): add per-platform baseline dirs + PR diff comment bot`
  - Files: `scripts/post-visual-diff-comment.mjs`, `apps/renderer/tests/visual/__snapshots__/{darwin,win32,linux}/.gitkeep`
  - Pre-commit: `node scripts/post-visual-diff-comment.mjs`

- [ ] 17. **Local developer helper scripts — single-command test tiers**

  **What to do**:
  - Add to root `package.json` scripts:
    - `"test:fast"`: `pnpm test:component && pnpm --filter @audiomorph/sidecar test` (mirrors PR-tier locally; <5min)
    - `"test:mid"`: `pnpm test:fast && pnpm test:integration && pnpm test:sidecar-integration && pnpm test:visual` (mirrors main-tier; <20min)
    - `"test:full"`: `pnpm test:mid && pnpm test:e2e` (mirrors nightly; <45min on warm cache)
    - `"test:visual:update"`: `pnpm exec playwright test --config=apps/renderer/playwright.visual.config.ts --update-snapshots`
    - `"test:e2e:headed"`: `PWDEBUG=1 pnpm exec playwright test --config=apps/shell/playwright.e2e.config.ts --headed` (dev debugging)
    - `"test:hf:warm"`: `node packages/test-helpers/scripts/warm-hf-cache.mjs` (pulls musicgen-small + whisper-tiny per manifest)
    - `"test:hf:verify"`: `node packages/test-helpers/scripts/verify-hf-cache.mjs` (checks SHAs match manifest)
  - Add `docs/testing.md` (markdown only — allowed):
    - One-paragraph overview of 6 test layers
    - Table: layer → command → runtime budget → CI tier
    - "First-time setup" section: clone, install, run `test:hf:warm` once
    - "Debugging" section: `test:e2e:headed`, snapshot update workflow
    - "What to run before pushing" decision tree

  **Must NOT do**:
  - Add scripts that bypass any layer (no `--no-tests` shortcut)
  - Document workflows that contradict the CI tiers (local must mirror CI exactly for the relevant tier)
  - Introduce new package managers or runners
  - Create `docs/` files outside `docs/testing.md` (one doc file only for this task)

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Mostly documentation + small script entries; clarity matters more than logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T16, T18, T19)
  - **Blocks**: T20, T21, T22 (CI workflows reference these scripts)
  - **Blocked By**: T7 (per-app scripts exist), T2 (HF cache helper)

  **References**:

  **Pattern References**:
  - `package.json` root - Existing scripts to extend, not replace
  - `packages/test-helpers/scripts/warm-hf-cache.mjs` (from T2) - Already documented behavior
  - `packages/test-helpers/scripts/verify-hf-cache.mjs` (from T2) - SHA verification

  **External References**:
  - pnpm script composition: `https://pnpm.io/cli/run` - `&&` chaining, recursive runs

  **WHY Each Reference Matters**:
  - Existing scripts must keep working — extension not replacement
  - HF cache helpers from T2 already exist; this task only exposes them at root

  **Acceptance Criteria**:

  - [ ] All 7 new scripts present in root `package.json` and runnable
  - [ ] `pnpm test:fast` completes <5min on warm cache
  - [ ] `docs/testing.md` exists, ≤3 pages, includes decision tree
  - [ ] Each documented command exists in `package.json`
  - [ ] `pnpm test:hf:verify` exits 0 after `pnpm test:hf:warm`

  **QA Scenarios**:

  ```
  Scenario: Fast tier runs under budget locally
    Tool: Bash
    Preconditions: T17 complete; deps installed
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. time pnpm test:fast 2>&1 | tail -10
    Expected Result: Exit 0; real time <5min
    Evidence: .sisyphus/evidence/task-17-test-fast.txt

  Scenario: All documented commands exist
    Tool: Bash
    Preconditions: T17 complete
    Steps:
      1. for cmd in test:fast test:mid test:full test:visual:update test:e2e:headed test:hf:warm test:hf:verify; do
           node -e "const p=require('./package.json'); console.log('$cmd', p.scripts['$cmd'] ? 'OK' : 'MISSING')";
         done
    Expected Result: All 7 commands print OK
    Evidence: .sisyphus/evidence/task-17-scripts-exist.txt

  Scenario: docs/testing.md exists and references all layers
    Tool: Bash
    Preconditions: T17 complete
    Steps:
      1. test -f docs/testing.md && echo FILE-OK
      2. for layer in component integration sidecar-integration visual e2e CI; do
           grep -qi "$layer" docs/testing.md && echo "$layer: ref-found";
         done
    Expected Result: FILE-OK + all 6 layers print ref-found
    Evidence: .sisyphus/evidence/task-17-docs-present.txt
  ```

  **Evidence to Capture**:
  - [ ] task-17-test-fast.txt
  - [ ] task-17-scripts-exist.txt
  - [ ] task-17-docs-present.txt

  **Commit**: YES
  - Message: `docs(testing): add tiered local commands + testing.md overview`
  - Files: `package.json`, `docs/testing.md`
  - Pre-commit: `pnpm test:fast`

- [ ] 18. **HF cache CI integration helper — restore/save with manifest-SHA cache key**

  **What to do**:
  - Create `scripts/ci-hf-cache-key.mjs`:
    - Reads `apps/sidecar/scripts/required-models.json` (from T2)
    - Computes SHA256 of the manifest content
    - Prints cache key: `hf-models-${platform}-${arch}-${manifestSha.slice(0,16)}`
    - Used by CI workflows as `key:` input to `actions/cache`
  - Create `scripts/ci-hf-cache-verify.mjs`:
    - Walks `~/.cache/huggingface/hub/`
    - For each model in manifest, asserts snapshot dir exists at pinned SHA
    - Exits 0 if all present, 1 if any missing (CI then runs warm script)
  - Add `pnpm ci:hf:key` and `pnpm ci:hf:verify` to root scripts
  - Both scripts: cross-platform path handling (use `os.homedir()` + `path.join`); no shell-isms
  - Document in `docs/testing.md` (extending T17's doc): "CI Cache Strategy" section

  **Must NOT do**:
  - Use shell commands for path manipulation (Node `path` only)
  - Hardcode `~/.cache` literal (use `os.homedir()`)
  - Skip the SHA verification on cache hit (must still validate)
  - Compute cache key based on file timestamps (manifest content only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Cross-platform path/hash utilities; small surface
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T16, T17, T19)
  - **Blocks**: T22 (nightly CI uses both)
  - **Blocked By**: T2 (manifest)

  **References**:

  **Pattern References**:
  - `apps/sidecar/scripts/required-models.json` (from T2) - Manifest source-of-truth
  - `packages/test-helpers/src/hf-cache.ts` (from T2) - Cache path resolution helper

  **External References**:
  - actions/cache key syntax: `https://github.com/actions/cache#cache-version` - Key segmentation strategy
  - HF Hub cache layout: `https://huggingface.co/docs/huggingface_hub/guides/manage-cache` - `models--{org}--{name}/snapshots/{sha}/`

  **WHY Each Reference Matters**:
  - Manifest hash in cache key means changing pinned SHA auto-invalidates cache (no stale models)
  - HF cache layout determines what files to verify exist

  **Acceptance Criteria**:

  - [ ] `pnpm ci:hf:key` prints deterministic key with manifest SHA prefix
  - [ ] `pnpm ci:hf:verify` exits 0 after warm, exits 1 after `rm -rf ~/.cache/huggingface/hub/models--*`
  - [ ] Cache key changes when manifest content changes
  - [ ] Cache key stable across runs when manifest unchanged

  **QA Scenarios**:

  ```
  Scenario: Cache key is deterministic and manifest-sensitive
    Tool: Bash
    Preconditions: T18 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. K1=$(pnpm ci:hf:key 2>/dev/null | tail -1)
      3. K2=$(pnpm ci:hf:key 2>/dev/null | tail -1)
      4. cp apps/sidecar/scripts/required-models.json /tmp/manifest.bak
      5. node -e "const f='apps/sidecar/scripts/required-models.json';const fs=require('fs');const j=JSON.parse(fs.readFileSync(f));j._test=Date.now();fs.writeFileSync(f,JSON.stringify(j,null,2))"
      6. K3=$(pnpm ci:hf:key 2>/dev/null | tail -1)
      7. cp /tmp/manifest.bak apps/sidecar/scripts/required-models.json
      8. echo "k1=$K1"; echo "k2=$K2"; echo "k3=$K3"; [ "$K1" = "$K2" ] && [ "$K1" != "$K3" ] && echo "DETERMINISTIC-AND-SENSITIVE"
    Expected Result: K1 == K2; K1 != K3; prints DETERMINISTIC-AND-SENSITIVE
    Evidence: .sisyphus/evidence/task-18-cache-key.txt

  Scenario: Verify fails cleanly when models missing
    Tool: Bash
    Preconditions: T18 complete; backup HF cache to safe location first
    Steps:
      1. HF_BACKUP=$(mktemp -d)
      2. [ -d "$HOME/.cache/huggingface/hub" ] && mv "$HOME/.cache/huggingface/hub" "$HF_BACKUP/"
      3. pnpm ci:hf:verify; CODE=$?
      4. [ -d "$HF_BACKUP/hub" ] && mv "$HF_BACKUP/hub" "$HOME/.cache/huggingface/"
      5. rm -rf "$HF_BACKUP"
      6. echo "exit=$CODE"
    Expected Result: exit=1
    Evidence: .sisyphus/evidence/task-18-verify-missing.txt
  ```

  **Evidence to Capture**:
  - [ ] task-18-cache-key.txt
  - [ ] task-18-verify-missing.txt

  **Commit**: YES
  - Message: `test(ci): add HF cache key + verify scripts for actions/cache integration`
  - Files: `scripts/ci-hf-cache-key.mjs`, `scripts/ci-hf-cache-verify.mjs`, `package.json`, `docs/testing.md` (extend)
  - Pre-commit: `pnpm ci:hf:key && pnpm ci:hf:verify`

- [ ] 19. **Real-engine smoke validator — independent sanity for nightly tier**

  **What to do**:
  - Create `scripts/smoke-real-engines.mjs`:
    - Spawns sidecar via `spawnSidecar()` from T8 with `AUDIOMORPH_TEST_MODE=1`
    - Sends POST `/generate` with `{"prompt":"smoke","duration":5}` and asserts:
      - Response 200 within 90s
      - Output file exists, is valid WAV (header check: starts with `RIFF....WAVE`)
      - Duration matches request ±0.5s (use `ffprobe` or read WAV header)
    - Sends POST `/transcribe` with `packages/test-helpers/fixtures/audio/speech-3s.wav` and asserts:
      - Response 200 within 60s
      - Returned text contains expected token (e.g., "test" or "hello")
      - At least 1 segment present
    - Kills sidecar cleanly
    - Exits 0 on full success, 1 on any failure with concrete reason printed
  - This is an independent canary — runs in nightly CI BEFORE the full E2E suite, so a model-incompatibility failure halts early with a cleaner signal
  - No mocking; real engines only

  **Must NOT do**:
  - Mock anything (this is the no-stub canary)
  - Skip duration validation (catches truncated audio bugs)
  - Allow runtime budget overflow (combined 150s hard cap, fail-fast)
  - Use the same SQLite DB as E2E (use tempfile)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Linear smoke test; deterministic with clear pass/fail
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T16, T17, T18)
  - **Blocks**: T22 (nightly CI calls this before E2E)
  - **Blocked By**: T8 (sidecar spawn helper), T6 (fixture audio)

  **References**:

  **Pattern References**:
  - `packages/test-helpers/src/sidecar.ts` (from T8) - `spawnSidecar()`
  - `packages/test-helpers/fixtures/audio/speech-3s.wav` (from T6) - Input audio

  **External References**:
  - WAV header spec: `https://docs.fileformat.com/audio/wav/` - RIFF/WAVE chunk layout for header validation
  - ffprobe duration: `https://ffmpeg.org/ffprobe.html` - `-show_entries format=duration`

  **WHY Each Reference Matters**:
  - Header check catches "file written but invalid format" bugs without needing ffmpeg
  - Duration check catches model truncation/padding bugs

  **Acceptance Criteria**:

  - [ ] `scripts/smoke-real-engines.mjs` exists
  - [ ] Runs end-to-end against real sidecar + real engines in <150s
  - [ ] Exits 0 on success with `[smoke] OK: generate=Xms, transcribe=Yms` line
  - [ ] Exits 1 with concrete error if generate or transcribe fails
  - [ ] Output WAV passes RIFF/WAVE header check

  **QA Scenarios**:

  ```
  Scenario: Smoke validator passes against warm cache
    Tool: Bash
    Preconditions: T19 complete; HF cache warm
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. AUDIOMORPH_TEST_MODE=1 time node scripts/smoke-real-engines.mjs 2>&1 | tee /tmp/smoke.log
      3. grep "\[smoke\] OK" /tmp/smoke.log
      4. echo "exit=$?"
    Expected Result: Prints "[smoke] OK: ..."; exit=0; real time <150s
    Evidence: .sisyphus/evidence/task-19-smoke-pass.txt

  Scenario: Smoke fails fast when sidecar refuses (test mode hooks broken)
    Tool: Bash
    Preconditions: T19 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. unset AUDIOMORPH_TEST_MODE; CI=true node scripts/smoke-real-engines.mjs 2>&1 | tail -5
      3. echo "exit=$?"
    Expected Result: Sidecar refuses to start (exit 78 per T4 spec); script exits 1 with clear message
    Evidence: .sisyphus/evidence/task-19-smoke-refuses.txt
  ```

  **Evidence to Capture**:
  - [ ] task-19-smoke-pass.txt
  - [ ] task-19-smoke-refuses.txt

  **Commit**: YES
  - Message: `test(smoke): add real-engine smoke validator for nightly canary`
  - Files: `scripts/smoke-real-engines.mjs`, `package.json` (script entry `smoke:engines`)
  - Pre-commit: `node scripts/smoke-real-engines.mjs` (skipped if no HF cache)

- [ ] 20. **CI workflow — `test-pr.yml` (PR tier, Linux smoke, <15min budget)**

  **What to do**:
  - Create `.github/workflows/test-pr.yml`:
    - Triggers: `on: pull_request` (any branch, any path)
    - Single job `pr-smoke` on `ubuntu-latest`
    - Steps:
      1. `actions/checkout@v4` with `submodules: true` (heartlib)
      2. `actions/setup-node@v4` with Node 22, pnpm cache
      3. `actions/setup-python@v5` with Python 3.12
      4. `pnpm install --frozen-lockfile`
      5. `pip install -r apps/sidecar/requirements.txt`
      6. `pnpm typecheck`
      7. `pnpm lint`
      8. `pnpm test:component` (renderer + shell + platform vitest = 96 tests)
      9. `pnpm --filter @audiomorph/sidecar test` (53 pytest unit tests)
      10. `pnpm test:integration` (renderer integration with real sidecar — 6 specs)
      11. `pnpm test:sidecar-integration` (pytest integration — 7 files)
      12. `pnpm scrub-secrets` (T15)
      13. Upload `.test-results/*.xml` as artifact
      14. Upload `playwright-report/` on failure only
    - `timeout-minutes: 15` job-level
    - `concurrency: { group: pr-${{ github.head_ref }}, cancel-in-progress: true }`
    - NO macOS, NO Windows, NO visual regression, NO E2E, NO real engines, NO HF download
  - Use pinned action SHAs (not floating `@v4` — exact commit SHA) for supply-chain safety
  - Set `permissions: { contents: read, pull-requests: write }` (write needed only if T16 bot runs in main tier)

  **Must NOT do**:
  - Run on `push:` events (PR-only to avoid double-billing)
  - Add macOS or Windows jobs (cost guard — nightly only)
  - Run E2E or visual regression (main/nightly tiers)
  - Download HF models (PR tier uses mocks only)
  - Allow `continue-on-error: true` on any step
  - Use floating action versions (must pin SHAs)
  - Cache anything beyond pnpm/pip (HF cache is nightly concern)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: GitHub Actions YAML with strict cost/time discipline; small surface but high blast radius if wrong
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T21, T22, T23, T24)
  - **Blocks**: None (terminal)
  - **Blocked By**: T15 (scrubber), T17 (root scripts), T10 (integration specs), T11 (pytest integration)

  **References**:

  **Pattern References**:
  - `.github/workflows/release.yml` - DO NOT MODIFY; reference only for style/conventions
  - `package.json` root scripts (from T17) - `test:component`, `test:integration`, `scrub-secrets`

  **External References**:
  - actions/checkout pinned SHA: `https://github.com/actions/checkout/releases` - Pick latest v4 SHA
  - actions/setup-node SHA: `https://github.com/actions/setup-node/releases`
  - GitHub Actions cost: `https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions` - Linux 1x, Windows 2x, macOS 10x

  **WHY Each Reference Matters**:
  - Pinning SHAs prevents supply-chain attacks via action repo compromise
  - Linux-only PR tier is the single biggest cost optimization

  **Acceptance Criteria**:

  - [ ] `.github/workflows/test-pr.yml` exists
  - [ ] `actionlint` passes on the workflow file
  - [ ] All action references use 40-char SHA, not version tags
  - [ ] Workflow runtime <15min on representative PR (measure via first real PR)
  - [ ] No macOS/Windows runners referenced
  - [ ] `release.yml` byte-identical to pre-task state (`git diff release.yml` empty)

  **QA Scenarios**:

  ```
  Scenario: Workflow file lints clean
    Tool: Bash
    Preconditions: T20 complete; actionlint installed (brew install actionlint or curl install)
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. actionlint .github/workflows/test-pr.yml 2>&1 | tee /tmp/actionlint-pr.log
      3. echo "exit=$?"
    Expected Result: No errors; exit=0
    Evidence: .sisyphus/evidence/task-20-actionlint.txt

  Scenario: No macOS or Windows runners referenced
    Tool: Bash
    Preconditions: T20 complete
    Steps:
      1. grep -E "macos-|windows-" .github/workflows/test-pr.yml; CODE=$?
      2. echo "grep-exit=$CODE (1=no matches=GOOD)"
    Expected Result: grep-exit=1 (no matches = clean)
    Evidence: .sisyphus/evidence/task-20-no-expensive-runners.txt

  Scenario: All action refs are pinned to SHAs
    Tool: Bash
    Preconditions: T20 complete
    Steps:
      1. grep -nE "uses: [^@]+@[a-z0-9]+$" .github/workflows/test-pr.yml | grep -vE "@[a-f0-9]{40}" | tee /tmp/unpinned.log
      2. [ ! -s /tmp/unpinned.log ] && echo "ALL-PINNED" || echo "UNPINNED-FOUND"
    Expected Result: Prints ALL-PINNED
    Evidence: .sisyphus/evidence/task-20-pinned-shas.txt

  Scenario: release.yml untouched
    Tool: Bash
    Preconditions: T20 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. git diff HEAD~1 -- .github/workflows/release.yml | wc -l
    Expected Result: 0 (no changes)
    Evidence: .sisyphus/evidence/task-20-release-untouched.txt
  ```

  **Evidence to Capture**:
  - [ ] task-20-actionlint.txt
  - [ ] task-20-no-expensive-runners.txt
  - [ ] task-20-pinned-shas.txt
  - [ ] task-20-release-untouched.txt

  **Commit**: YES
  - Message: `ci(test): add PR-tier workflow with Linux smoke under 15min budget`
  - Files: `.github/workflows/test-pr.yml`
  - Pre-commit: `actionlint .github/workflows/test-pr.yml`

- [ ] 21. **CI workflow — `test-main.yml` (main tier, Linux + visual regression, <30min)**

  **What to do**:
  - Create `.github/workflows/test-main.yml`:
    - Triggers: `on: push: { branches: [main] }`
    - Two jobs (parallel):
      - Job A `main-full-linux` on `ubuntu-latest`:
        - Steps 1-11 identical to T20 PR tier
        - Plus: `pnpm test:visual` (visual regression, Linux baselines only)
        - Plus: `pnpm scrub-secrets`
        - Plus: Upload `apps/renderer/tests/visual/__snapshots__/linux/**` as artifact
        - Plus: Call `node scripts/post-visual-diff-comment.mjs` (T16) — but in push context, bot will skip silently
        - `timeout-minutes: 30`
      - Job B `main-deps-audit` on `ubuntu-latest`:
        - `pnpm audit --audit-level=high`
        - `pip-audit -r apps/sidecar/requirements.txt`
        - `timeout-minutes: 5`
        - `continue-on-error: false`
    - NO baseline auto-update (per constraint — local + dedicated workflow only)
    - NO E2E, NO real engines, NO macOS, NO Windows
    - Same SHA-pinning rules as T20

  **Must NOT do**:
  - Auto-update visual baselines (NEVER on main push — only via dedicated T23 workflow)
  - Add E2E (nightly only)
  - Run on PR events (PR tier handles those)
  - Skip the deps audit job (security perimeter)
  - Allow audit to soft-fail

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multi-job YAML with strict invariants
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T20, T22, T23, T24)
  - **Blocks**: None (terminal)
  - **Blocked By**: T12 (visual suite), T16 (diff bot), T15 (scrubber)

  **References**:

  **Pattern References**:
  - `.github/workflows/test-pr.yml` (from T20) - Job template to mirror for steps 1-11
  - `apps/renderer/playwright.visual.config.ts` (from T7) - Visual config invoked by `test:visual`

  **External References**:
  - actions/upload-artifact v4 SHA: `https://github.com/actions/upload-artifact/releases`
  - pip-audit: `https://github.com/pypa/pip-audit` - Python deps audit

  **WHY Each Reference Matters**:
  - Mirroring PR steps 1-11 keeps the two workflows consistent (avoid drift bugs)
  - pip-audit catches Python supply-chain issues that pnpm audit misses

  **Acceptance Criteria**:

  - [ ] `.github/workflows/test-main.yml` exists
  - [ ] `actionlint` passes
  - [ ] All action refs SHA-pinned
  - [ ] Two jobs declared: `main-full-linux`, `main-deps-audit`
  - [ ] Visual suite runs and uploads Linux baselines
  - [ ] No `--update-snapshots` flag anywhere
  - [ ] Workflow runtime <30min target

  **QA Scenarios**:

  ```
  Scenario: Main workflow has no baseline auto-update
    Tool: Bash
    Preconditions: T21 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. grep -E "update-snapshots|update_snapshots" .github/workflows/test-main.yml; CODE=$?
      3. echo "grep-exit=$CODE (1=clean)"
    Expected Result: grep-exit=1
    Evidence: .sisyphus/evidence/task-21-no-auto-update.txt

  Scenario: Both jobs declared and SHA-pinned
    Tool: Bash
    Preconditions: T21 complete
    Steps:
      1. grep -E "^  [a-z][a-z0-9-]+:$" .github/workflows/test-main.yml | tee /tmp/jobs.log
      2. wc -l /tmp/jobs.log
      3. grep -nE "uses: [^@]+@[a-z0-9]+$" .github/workflows/test-main.yml | grep -vE "@[a-f0-9]{40}" | tee /tmp/unpinned.log
      4. [ ! -s /tmp/unpinned.log ] && echo "ALL-PINNED" || echo "UNPINNED-FOUND"
    Expected Result: 2 jobs printed; ALL-PINNED
    Evidence: .sisyphus/evidence/task-21-jobs-pinned.txt

  Scenario: Trigger restricted to main branch push
    Tool: Bash
    Preconditions: T21 complete
    Steps:
      1. grep -A2 "^on:" .github/workflows/test-main.yml | head -5
    Expected Result: Output shows push.branches: [main]; no pull_request trigger
    Evidence: .sisyphus/evidence/task-21-trigger.txt
  ```

  **Evidence to Capture**:
  - [ ] task-21-no-auto-update.txt
  - [ ] task-21-jobs-pinned.txt
  - [ ] task-21-trigger.txt

  **Commit**: YES
  - Message: `ci(test): add main-tier workflow with visual regression + deps audit`
  - Files: `.github/workflows/test-main.yml`
  - Pre-commit: `actionlint .github/workflows/test-main.yml`

- [ ] 22. **CI workflow — `test-nightly.yml` (3-platform matrix, real engines, <90min)**

  **What to do**:
  - Create `.github/workflows/test-nightly.yml`:
    - Triggers: `on: schedule: [cron: '0 7 * * *']` (07:00 UTC daily) + `workflow_dispatch` (manual)
    - Single matrix job `nightly-full` with `strategy.matrix.os: [ubuntu-latest, macos-14, windows-latest]`
    - `strategy.fail-fast: false` (each platform reports independently)
    - Steps:
      1. checkout (with submodules)
      2. setup-node, setup-python
      3. `pnpm install --frozen-lockfile`
      4. `pip install -r apps/sidecar/requirements.txt`
      5. `actions/cache@<sha>` for HF models:
         - `path: ~/.cache/huggingface/hub`
         - `key: $(node scripts/ci-hf-cache-key.mjs)` (T18)
      6. `pnpm ci:hf:verify` — if exits 1, run `pnpm test:hf:warm`
      7. `pnpm typecheck && pnpm lint`
      8. `pnpm test:component`
      9. `pnpm --filter @audiomorph/sidecar test`
      10. `pnpm test:integration`
      11. `pnpm test:sidecar-integration`
      12. `pnpm test:visual` — uses per-OS baselines under `__snapshots__/{os}/`
      13. `node scripts/smoke-real-engines.mjs` (T19) — fail-fast canary BEFORE E2E
      14. `pnpm test:e2e` (T14)
      15. `pnpm scrub-secrets` (T15)
      16. Upload `.test-results/*.xml`, `playwright-report/`, visual diffs as artifacts
    - `timeout-minutes: 90` job-level
    - Cost guard: `if: github.repository == 'OWNER/REPO'` on schedule (prevents forks from triggering paid runners) — placeholder OWNER/REPO replaced at execution time by user/Sisyphus
  - Add failure notification: `if: failure()` step that creates GitHub issue with label `nightly-failure` (no Slack/email per constraint)

  **Must NOT do**:
  - Run on every push (schedule + dispatch only — cost guard)
  - Skip the smoke canary before E2E (must fail fast on engine issues)
  - Use `fail-fast: true` (each platform must report independently)
  - Mock anything (this is the real-engine tier)
  - Skip HF cache (would blow time budget on every run)
  - Send notifications via Slack/email (GitHub issue only)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Multi-platform matrix with cache lifecycle, fallbacks, and budget discipline; multiple failure modes to reason about
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T20, T21, T23, T24)
  - **Blocks**: None (terminal)
  - **Blocked By**: T14 (E2E), T18 (HF cache scripts), T19 (smoke validator)

  **References**:

  **Pattern References**:
  - `.github/workflows/test-pr.yml` (from T20) - Linux step template
  - `.github/workflows/release.yml` - DO NOT MODIFY; reference for matrix YAML style only
  - `scripts/ci-hf-cache-key.mjs` (from T18), `scripts/ci-hf-cache-verify.mjs` (from T18)
  - `scripts/smoke-real-engines.mjs` (from T19)

  **External References**:
  - actions/cache v4 SHA: `https://github.com/actions/cache/releases`
  - cron expression validator: `https://crontab.guru/#0_7_*_*_*` - "At 07:00 every day"
  - matrix strategy: `https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs`

  **WHY Each Reference Matters**:
  - 07:00 UTC = quiet time across most timezones; runners less contended
  - `fail-fast: false` means a Windows-specific bug doesn't mask macOS/Linux passes

  **Acceptance Criteria**:

  - [ ] `.github/workflows/test-nightly.yml` exists
  - [ ] `actionlint` passes
  - [ ] Matrix has exactly 3 OSes: ubuntu-latest, macos-14, windows-latest
  - [ ] `fail-fast: false` set
  - [ ] Smoke validator runs BEFORE E2E
  - [ ] HF cache restored before any test that needs models
  - [ ] Schedule trigger present + workflow_dispatch present
  - [ ] Fork guard present on schedule
  - [ ] Issue-creation step on failure
  - [ ] No Slack/email notifications

  **QA Scenarios**:

  ```
  Scenario: Matrix has exactly 3 platforms with fail-fast disabled
    Tool: Bash
    Preconditions: T22 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. grep -E "ubuntu-latest|macos-14|windows-latest" .github/workflows/test-nightly.yml | wc -l
      3. grep "fail-fast: false" .github/workflows/test-nightly.yml
    Expected Result: 3+ OS refs; fail-fast: false present
    Evidence: .sisyphus/evidence/task-22-matrix.txt

  Scenario: Smoke validator precedes E2E in workflow
    Tool: Bash
    Preconditions: T22 complete
    Steps:
      1. SMOKE_LINE=$(grep -n "smoke-real-engines" .github/workflows/test-nightly.yml | head -1 | cut -d: -f1)
      2. E2E_LINE=$(grep -n "test:e2e" .github/workflows/test-nightly.yml | head -1 | cut -d: -f1)
      3. echo "smoke=$SMOKE_LINE e2e=$E2E_LINE"
      4. [ "$SMOKE_LINE" -lt "$E2E_LINE" ] && echo "ORDER-OK" || echo "ORDER-WRONG"
    Expected Result: smoke line < e2e line; prints ORDER-OK
    Evidence: .sisyphus/evidence/task-22-canary-order.txt

  Scenario: Schedule + dispatch triggers present; no push trigger
    Tool: Bash
    Preconditions: T22 complete
    Steps:
      1. grep -E "schedule:|workflow_dispatch:" .github/workflows/test-nightly.yml | wc -l
      2. grep -E "^  push:" .github/workflows/test-nightly.yml; CODE=$?
      3. echo "push-grep=$CODE (1=clean)"
    Expected Result: 2 trigger types present; push-grep=1
    Evidence: .sisyphus/evidence/task-22-triggers.txt

  Scenario: actionlint clean
    Tool: Bash
    Preconditions: T22 complete; actionlint installed
    Steps:
      1. actionlint .github/workflows/test-nightly.yml 2>&1 | tee /tmp/actionlint-nightly.log
      2. echo "exit=$?"
    Expected Result: No errors; exit=0
    Evidence: .sisyphus/evidence/task-22-actionlint.txt
  ```

  **Evidence to Capture**:
  - [ ] task-22-matrix.txt
  - [ ] task-22-canary-order.txt
  - [ ] task-22-triggers.txt
  - [ ] task-22-actionlint.txt

  **Commit**: YES
  - Message: `ci(test): add nightly 3-platform workflow with HF cache + real engines`
  - Files: `.github/workflows/test-nightly.yml`
  - Pre-commit: `actionlint .github/workflows/test-nightly.yml`

- [ ] 23. **CI workflow — `update-visual-baselines.yml` (manual dispatch, per-OS)**

  **What to do**:
  - Create `.github/workflows/update-visual-baselines.yml`:
    - Triggers: `on: workflow_dispatch:` with inputs:
      - `platforms` (choice): `linux`, `macos`, `windows`, `all` (default: `all`)
      - `branch` (string): branch to commit baselines to (default: current ref)
      - `reason` (string, required): justification recorded in commit message
    - Single matrix job `update-baselines` filtered by input:
      - `matrix.os` derived from `inputs.platforms` (use `fromJSON` mapping)
      - Steps:
        1. checkout (with submodules) on `inputs.branch`
        2. setup-node, setup-python, pnpm install, pip install
        3. Restore HF cache (same key as T22)
        4. `pnpm ci:hf:verify` — fail if missing (do NOT warm here; this workflow only updates baselines, not models)
        5. `pnpm test:visual -- --update-snapshots`
        6. `git config user.name "audiomorph-baseline-bot"` and `user.email "bot@audiomorph.local"`
        7. `git add apps/renderer/tests/visual/__snapshots__/${{ matrix.os }}/`
        8. `git commit -m "chore(visual): update ${{ matrix.os }} baselines — ${{ inputs.reason }}"` (skip if no changes via `git diff --cached --quiet || git commit ...`)
        9. `git push origin ${{ inputs.branch }}`
    - `timeout-minutes: 45`
    - Concurrency: `group: visual-update-${{ inputs.branch }}, cancel-in-progress: false`
    - Requires `permissions: { contents: write }` (push to branch)
    - Protected: add `if: github.actor == github.repository_owner || contains(fromJSON('["MAINTAINER_USER"]'), github.actor)` placeholder gate (user replaces MAINTAINER_USER list)

  **Must NOT do**:
  - Trigger automatically (manual dispatch ONLY — per constraint)
  - Run on `pull_request_target` (security risk with write perms)
  - Update baselines for platforms not selected
  - Commit if no actual baseline changes (avoid empty commits)
  - Force-push (use regular push only)
  - Skip the actor gate (anyone with write access could re-baseline maliciously without it)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Workflow with write permissions and human-in-loop safeguards; security-sensitive
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T20, T21, T22, T24)
  - **Blocks**: None (terminal)
  - **Blocked By**: T12 (visual suite), T16 (per-OS baseline dirs), T18 (HF cache scripts)

  **References**:

  **Pattern References**:
  - `.github/workflows/test-nightly.yml` (from T22) - HF cache restore step template
  - `apps/renderer/tests/visual/__snapshots__/{darwin,win32,linux}/` (from T12) - Per-OS baseline dir convention

  **External References**:
  - workflow_dispatch inputs: `https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_dispatch`
  - `fromJSON` function: `https://docs.github.com/en/actions/learn-github-actions/expressions#fromjson`
  - GitHub Actions security hardening: `https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions`

  **WHY Each Reference Matters**:
  - Manual-only triggers prevent unauthorized baseline changes via PR
  - Actor gate enforces human-reviewed baseline updates only

  **Acceptance Criteria**:

  - [ ] `.github/workflows/update-visual-baselines.yml` exists
  - [ ] `actionlint` passes
  - [ ] Only `workflow_dispatch` trigger present (no schedule, push, or PR)
  - [ ] `reason` input is required
  - [ ] Actor gate present
  - [ ] Commits only when diff exists
  - [ ] Per-OS baselines updated based on input

  **QA Scenarios**:

  ```
  Scenario: Only workflow_dispatch trigger present
    Tool: Bash
    Preconditions: T23 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. grep -E "^on:|workflow_dispatch:|schedule:|^  push:|pull_request" .github/workflows/update-visual-baselines.yml | tee /tmp/triggers.log
      3. grep -cE "schedule:|^  push:|pull_request" .github/workflows/update-visual-baselines.yml
    Expected Result: workflow_dispatch present; other-triggers count = 0
    Evidence: .sisyphus/evidence/task-23-manual-only.txt

  Scenario: Reason input is required
    Tool: Bash
    Preconditions: T23 complete
    Steps:
      1. grep -A3 "reason:" .github/workflows/update-visual-baselines.yml | grep "required: true"
    Expected Result: required: true line present under reason input
    Evidence: .sisyphus/evidence/task-23-reason-required.txt

  Scenario: Actor gate and empty-commit guard present
    Tool: Bash
    Preconditions: T23 complete
    Steps:
      1. grep -E "github.actor|repository_owner" .github/workflows/update-visual-baselines.yml
      2. grep "git diff --cached --quiet" .github/workflows/update-visual-baselines.yml
    Expected Result: Both grep matches return at least one line
    Evidence: .sisyphus/evidence/task-23-guards.txt

  Scenario: actionlint clean
    Tool: Bash
    Preconditions: T23 complete; actionlint installed
    Steps:
      1. actionlint .github/workflows/update-visual-baselines.yml 2>&1 | tee /tmp/actionlint-baselines.log
      2. echo "exit=$?"
    Expected Result: exit=0
    Evidence: .sisyphus/evidence/task-23-actionlint.txt
  ```

  **Evidence to Capture**:
  - [ ] task-23-manual-only.txt
  - [ ] task-23-reason-required.txt
  - [ ] task-23-guards.txt
  - [ ] task-23-actionlint.txt

  **Commit**: YES
  - Message: `ci(visual): add manual-dispatch baseline-update workflow with actor gate`
  - Files: `.github/workflows/update-visual-baselines.yml`
  - Pre-commit: `actionlint .github/workflows/update-visual-baselines.yml`

- [ ] 24. **CI cost guards — concurrency, path filters, fork protection**

  **What to do**:
  - Audit all four new workflows (`test-pr.yml`, `test-main.yml`, `test-nightly.yml`, `update-visual-baselines.yml`) and add:
    1. **Concurrency groups** (cancel superseded runs):
       - `test-pr.yml`: `group: pr-${{ github.head_ref }}, cancel-in-progress: true`
       - `test-main.yml`: `group: main-${{ github.sha }}, cancel-in-progress: false` (don't kill main builds)
       - `test-nightly.yml`: `group: nightly-${{ github.run_id }}, cancel-in-progress: false`
       - `update-visual-baselines.yml`: already set by T23
    2. **Path filters** on PR tier (skip pure-docs PRs):
       - `paths-ignore: ['**.md', 'docs/**', '.github/ISSUE_TEMPLATE/**', 'LICENSE']`
    3. **Fork protection**:
       - On `test-pr.yml`: `if: github.event.pull_request.head.repo.full_name == github.repository` for any step needing secrets (none currently — but mark with comment for future)
       - On `test-nightly.yml`: `if: github.repository_owner == 'OWNER'` (placeholder for user to replace) on schedule trigger to prevent fork-billed runs
    4. **Default `permissions: { contents: read }`** at workflow level (least-privilege baseline); jobs needing more (e.g., T23 baseline-update) override explicitly
    5. **`timeout-minutes`** at BOTH job and step levels for any step >5min expected duration (e.g., `pnpm test:e2e` step in T22 gets `timeout-minutes: 25`)
  - Create `docs/ci-cost-guards.md` documenting:
    - Estimated monthly cost per tier (Linux/macOS/Windows minute counts × GitHub Actions pricing)
    - How concurrency groups save cost
    - How to investigate if a workflow exceeds budget
    - Kill-switch instructions (disable workflow via UI in <30s)

  **Must NOT do**:
  - Add concurrency to `release.yml` (do not touch)
  - Use `cancel-in-progress: true` on main or nightly (would lose data on superseded runs)
  - Grant `permissions: write-all` anywhere
  - Skip path filters on PR (every doc-only PR otherwise burns 10+ minutes)
  - Hardcode owner name in test-nightly fork guard (must be placeholder OWNER for user replacement)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multi-file audit + documentation; cost discipline requires precision
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (modifies files created by T20-T23)
  - **Parallel Group**: Sequential after T20-T23
  - **Blocks**: None (terminal)
  - **Blocked By**: T20, T21, T22, T23

  **References**:

  **Pattern References**:
  - `.github/workflows/test-pr.yml` (T20), `test-main.yml` (T21), `test-nightly.yml` (T22), `update-visual-baselines.yml` (T23) - All four targets of audit

  **External References**:
  - Concurrency docs: `https://docs.github.com/en/actions/using-jobs/using-concurrency`
  - Path filters: `https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#using-filters`
  - Default permissions: `https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token`
  - Actions pricing: `https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions#minute-multipliers`

  **WHY Each Reference Matters**:
  - cancel-in-progress on PR tier saves ~80% of CI cost on rapid-rebase workflows
  - Default contents:read prevents accidental write escalation in transitive action calls
  - Minute multipliers (mac=10x, win=2x) explain why nightly-only multi-OS matters

  **Acceptance Criteria**:

  - [ ] All four workflow files have explicit `permissions:` block
  - [ ] All four have concurrency groups with correct cancel-in-progress policy
  - [ ] `test-pr.yml` has `paths-ignore` filter for docs
  - [ ] `test-nightly.yml` has fork guard on schedule
  - [ ] Every step >5min has step-level `timeout-minutes`
  - [ ] `docs/ci-cost-guards.md` exists with all 4 sections (cost estimate, concurrency, investigation, kill-switch)
  - [ ] `actionlint` passes on all four workflows post-edit
  - [ ] `release.yml` byte-identical to pre-task state

  **QA Scenarios**:

  ```
  Scenario: All workflows have explicit permissions block
    Tool: Bash
    Preconditions: T24 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. for f in test-pr test-main test-nightly update-visual-baselines; do
           echo "=== $f ===";
           grep -A1 "^permissions:" .github/workflows/$f.yml || echo "MISSING";
         done | tee /tmp/perms.log
      3. ! grep "MISSING" /tmp/perms.log && echo "ALL-PRESENT"
    Expected Result: All four show permissions block; prints ALL-PRESENT
    Evidence: .sisyphus/evidence/task-24-permissions.txt

  Scenario: Concurrency policies correct per tier
    Tool: Bash
    Preconditions: T24 complete
    Steps:
      1. grep -A2 "^concurrency:" .github/workflows/test-pr.yml | grep "cancel-in-progress: true"
      2. grep -A2 "^concurrency:" .github/workflows/test-main.yml | grep "cancel-in-progress: false"
      3. grep -A2 "^concurrency:" .github/workflows/test-nightly.yml | grep "cancel-in-progress: false"
    Expected Result: All three grep commands succeed (exit 0)
    Evidence: .sisyphus/evidence/task-24-concurrency.txt

  Scenario: PR tier ignores docs-only changes
    Tool: Bash
    Preconditions: T24 complete
    Steps:
      1. grep -A5 "paths-ignore:" .github/workflows/test-pr.yml | grep -E "\*\*\.md|docs/"
    Expected Result: Both **.md and docs/ patterns present
    Evidence: .sisyphus/evidence/task-24-path-filter.txt

  Scenario: release.yml unchanged
    Tool: Bash
    Preconditions: T24 complete
    Steps:
      1. cd /Users/hellhound/projects/mine/audiomorph-studio
      2. git log --oneline -- .github/workflows/release.yml | head -5
      3. git diff HEAD~5 -- .github/workflows/release.yml | wc -l
    Expected Result: 0 (no changes since task series started)
    Evidence: .sisyphus/evidence/task-24-release-untouched.txt

  Scenario: Cost-guard docs complete
    Tool: Bash
    Preconditions: T24 complete
    Steps:
      1. test -f docs/ci-cost-guards.md && echo "FILE-EXISTS"
      2. for section in "Estimated monthly cost" "Concurrency" "Investigation" "Kill-switch"; do
           grep -i "$section" docs/ci-cost-guards.md > /dev/null && echo "OK: $section" || echo "MISSING: $section";
         done
    Expected Result: FILE-EXISTS; all 4 sections present
    Evidence: .sisyphus/evidence/task-24-docs.txt
  ```

  **Evidence to Capture**:
  - [ ] task-24-permissions.txt
  - [ ] task-24-concurrency.txt
  - [ ] task-24-path-filter.txt
  - [ ] task-24-release-untouched.txt
  - [ ] task-24-docs.txt

  **Commit**: YES
  - Message: `ci(guards): add concurrency groups, path filters, fork protection, cost docs`
  - Files: `.github/workflows/test-pr.yml`, `.github/workflows/test-main.yml`, `.github/workflows/test-nightly.yml`, `.github/workflows/update-visual-baselines.yml`, `docs/ci-cost-guards.md`
  - Pre-commit: `for f in .github/workflows/test-{pr,main,nightly}.yml .github/workflows/update-visual-baselines.yml; do actionlint $f; done`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (file present, command exits 0). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Verify `release.yml` untouched (`git diff main..HEAD -- .github/workflows/release.yml` empty). Verify existing 96 vitest + 53 pytest test counts unchanged.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm typecheck` + `pnpm lint` + full `pnpm test` (unit + integration + sidecar-integration + e2e + visual + component). Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod paths, commented-out code, unused imports, `page.waitForTimeout()` usage in integration/E2E. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify scrubber unit tests pass (planted-token grep returns empty).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real CI QA** — `unspecified-high` (+ `playwright` skill if local repro needed)
  Push branch `test/verify-ci` with all changes. Trigger each workflow: `gh workflow run test-pr.yml`, `gh workflow run test-main.yml`, `gh workflow run test-nightly.yml`, `gh workflow run update-visual-baselines.yml`. Wait for completion. Verify all green, wall times within budget (PR<15min, Main<30min, Nightly<90min). Download artifacts, verify `.test-results/*.xml` present, verify scrubber works (grep planted token in logs returns 0). Push deliberate 1-pixel UI change to a tracked component, verify visual regression fails on next run with diff artifact on PR. Push commit with model revision SHA changed, verify cache miss + re-download in next nightly run.
  Output: `Workflows [4/4 GREEN] | Budgets [N/N within cap] | Cache [HIT/MISS as expected] | Scrubber [0 leaks] | Visual diff [TRIGGERED] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance per task. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes. Specifically verify: zero modifications to `apps/sidecar/src/`, `apps/shell/src/`, `apps/renderer/src/` (except test-mode env hooks clearly marked behind `if (process.env.AUDIOMORPH_TEST_MODE)` guards). Verify `release.yml` byte-identical to commit `efa4f08`.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | Product code [UNTOUCHED/MODIFIED] | release.yml [UNTOUCHED/MODIFIED] | VERDICT`

---

## Commit Strategy

Atomic commits, one per task (24 task commits + 4 verification commits). Format: `test(<scope>): <description>`. Scopes: `helpers`, `component`, `integration`, `sidecar-it`, `e2e`, `visual`, `ci`, `manifest`, `scrubber`. Each commit includes only files for that task. Pre-commit hook: `pnpm typecheck && pnpm lint`.

---

## Success Criteria

### Verification Commands

```bash
# All test layers green
pnpm test:component                      # Expected: exit 0, ≥25 tests, .test-results/component.xml exists
pnpm test:integration                    # Expected: exit 0, ≥18 tests, .test-results/integration.xml exists
pnpm test:sidecar-integration            # Expected: exit 0, ≥21 tests, .test-results/sidecar-integration.xml exists
pnpm test:e2e                            # Expected: exit 0, ≥12 tests, .test-results/e2e.xml exists, wall <25min
pnpm test:visual                         # Expected: exit 0, ≥36 snapshots compared (current platform only)
pnpm test                                # Expected: exit 0, existing vitest+pytest counts unchanged from efa4f08

# CI workflows green
gh workflow run test-pr.yml --ref test/verify-ci && gh run watch    # Expected: GREEN, <15 min
gh workflow run test-main.yml --ref test/verify-ci && gh run watch  # Expected: GREEN, <30 min
gh workflow run test-nightly.yml --ref main && gh run watch         # Expected: GREEN, <90 min

# Scrubber sanity
echo "X-Audiomorph-Token: sk-or-v1-PLANTED-FAKE" > /tmp/test.log
node packages/test-helpers/dist/scrubber-cli.js /tmp/test.log
grep PLANTED-FAKE /tmp/test.log         # Expected: 0 matches

# Cache invalidation
jq '.models[0].revision = "different-sha"' apps/sidecar/scripts/required-models.json > /tmp/m.json
mv /tmp/m.json apps/sidecar/scripts/required-models.json
# Next nightly CI run: expect cache MISS in logs, re-download triggered

# Untouched files
git diff main..HEAD -- .github/workflows/release.yml | wc -l  # Expected: 0
```

### Final Checklist

- [ ] All "Must Have" present and verified by command
- [ ] All "Must NOT Have" absent (no forbidden patterns in grep)
- [ ] All 24 task commits land + 4 verification commits
- [ ] All 4 CI workflows green within budget
- [ ] Visual regression PR-comment workflow demonstrated end-to-end
- [ ] HF model cache hit on second nightly run, miss on revision-SHA change
- [ ] Secret scrubber verified: planted token does not leak to any artifact
- [ ] Zero product source modifications outside marked test-mode hooks
- [ ] User explicitly approves F1-F4 results
