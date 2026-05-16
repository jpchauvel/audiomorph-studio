# AudioMorph Studio — Cross-Platform AI Music Generation Desktop App

## TL;DR

> **Quick Summary**: Build "AudioMorph Studio" from scratch — an Electron desktop app wrapping the vendored `heartlib` submodule (HeartMuLa music LLM + HeartCodec + HeartCLAP) for local AI music generation. Backend = Python 3.14 FastAPI sidecar; frontend = Next.js + Tailwind + Zustand with "Dark Precision" UI; packaged with electron-builder for macOS Apple Silicon, Windows + NVIDIA CUDA, and Linux + NVIDIA CUDA. No accounts, no telemetry, no auto-update, no cloud — fully local with BYOK OpenRouter for lyrics assistance.
>
> **Deliverables**:
> - `audiomorph-studio` Electron app installable on 3 target platforms (`.dmg`, `.exe`/NSIS, `.AppImage`+`.deb`)
> - FastAPI Python 3.14 sidecar bundled via python-build-standalone with vendored `heartlib`
> - Next.js static-export frontend with shadcn/ui + Magic UI components, wavesurfer.js v7 + Canvas FFT visualizer
> - SQLite (SQLModel) library for history, favorites, queue, settings
> - First-run wizard: hardware check → model storage location → consented HF model download
> - 9 MVP features: text-to-song, lyrics input, LLM lyrics generation, reference audio conditioning, song library, multi-language, WAV/FLAC/MP3 export, seed control, bitsandbytes int8/int4 quantization
> - Phase 0 pre-flight verification artifacts (wheel matrix, PBS availability, ffmpeg 8 source, heartlib API contract)
>
> **Estimated Effort**: XL (~38 tasks across 6 waves)
> **Parallel Execution**: YES — 6 waves (Phase 0 + Waves 1-5)
> **Critical Path**: P0.4 (heartlib API contract) → W1.5 (Python sidecar bootstrap) → W2.3 (generation service) → W3.6 (player UI) → W4.3 (Electron sidecar lifecycle) → W5.1 (per-OS installer) → F1-F4 → user okay

---

## Context

### Original Request
> "I want to do reverse-engineering and rebuild from the ground up HeartMuLa Studio (https://github.com/fspecii/HeartMuLa-Studio). At the core I want to use `heartlib` which I've modified to be in a functional state for Apple Silicon machines. The repo is practically empty aside from just the heartlib submodule. Use the best looking web design for the frontend."
>
> Stack: Backend = Python 3.14, heartlib (https://github.com/jpchauvel/heartlib), FastAPI, sqlite3, Hugging Face CLI, ffmpeg 8. Frontend = TypeScript, Next.js, React, PWA, Zustand, Tailwind. Distribution = Electron with per-OS dependency installers.

### Interview Summary

**Round 1 Decisions**:
- Project name: **AudioMorph Studio**
- Scope: MVP first, expand later
- Input mode: Local file upload (drag & drop) — for **reference audio** (style conditioning, not separation source)
- Model strategy: Background pre-fetch with user consent
- Dependency strategy: **Fully bundled installer** (zero-setup, large size acceptable)
- Test strategy: **Full TDD** (RED-GREEN-REFACTOR)
- Auto-update: **No** (manual reinstall only)

**Round 2 Decisions (Domain Pivot)**:
- Domain corrected: NOT audio source separation → **AI music generation** (Suno-like)
- All **9 MVP features** selected (see Work Objectives)
- Player UI: **Waveform (wavesurfer.js v7) + live FFT spectrum** side-by-side

**Round 3 Decisions (Metis-driven blockers resolved)**:
- Python version: **3.14** (bitsandbytes 0.49.2 ships cp314 wheels verified on PyPI Feb 2026)
- Platform matrix: **macOS Apple Silicon (MPS) + Windows NVIDIA CUDA + Linux NVIDIA CUDA ONLY**
- No-GPU behavior: **Installer refuses to install** with unsupported-hardware error
- Model storage: **First-run wizard prompts user** (default `~/.cache/huggingface/hub`, custom path allowed incl. external drive)
- heartlib API: **Reverse-engineer from `heartlib/examples/`** + read `heartlib/src/heartlib/` modules → produce contract doc

### Research Findings

- **heartlib**: HeartMuLa music LM + HeartCodec + HeartTranscriptor (Whisper-based) + HeartCLAP (audio-text). Output = single mixed song (NOT stems), up to 4 min. Deps: numpy 2.2.0, torch 2.4-2.11, torchcodec 0.10.0, transformers 4.57.0, bitsandbytes 0.49.0. `requires-python = ">=3.10.0"`.
- **HF Models** (~10GB total): `HeartMuLa/HeartMuLaGen`, `HeartMuLa/HeartMuLa-oss-3B-happy-new-year`, `HeartMuLa/HeartCodec-oss-20260123`.
- **Python bundling**: python-build-standalone (PBS) by astral-sh — used by `uv`, supports runtime pip, embeds Python 3.14.
- **ffmpeg 8.0**: released Aug 2025; static builds from BtbN (Linux/Win) + evermeet (macOS); bundle to `extraResources/ffmpeg/{platform}-{arch}/`.
- **Electron**: electron-builder with extraResources + asarUnpack, contextBridge IPC, sidecar spawned by main process on ephemeral port + shared-secret header.
- **UI direction**: "Dark Precision" — OKLCH tokens, Geist font, shadcn/ui + Magic UI accents (Linear-style minimalism).
- **bitsandbytes capability matrix**: full on Win/Linux CUDA; on macOS arm64 LLM.int8() + QLoRA 4-bit work but slow; 8-bit optimizers unsupported on macOS.

### Metis Review

**Blocking gaps RESOLVED in Round 3** (Python wheels, GPU matrix, CPU fallback, model storage, heartlib API).

**High-priority gaps ADDRESSED in plan**:
- Sidecar zombie processes → main-process PID tracking + SIGTERM on quit (W4.3)
- Sidecar↔renderer port collision → ephemeral port + shared-secret header (W1.5 + W4.3)
- OpenRouter API key in plaintext SQLite (security) → Electron `safeStorage`/keytar (W4.5)
- "Premium UI" subjective acceptance → replaced with concrete a11y contrast + 55fps + OKLCH coverage gates (W3.1)
- bitsandbytes CUDA-only in practice → quantization gated behind GPU detection + macOS warning (W2.4)
- Partial download resume + model corruption SHA256 check (W2.2)
- Generation cancellation + OOM handling (W2.3)
- ffmpeg conversion failure handling (W2.6)
- File path special chars + locale + HiDPI rendering (W3.1)

**Mandatory plan structure additions**:
- **Phase 0 (Pre-Flight Verification)** before any feature work
- Explicit **MUST-NOT list** baked into Work Objectives
- Every task has **agent-executable QA** (no "user verifies")

---

## Work Objectives

### Core Objective
Ship a cross-platform Electron desktop app that lets a user generate AI music locally from text prompts + lyrics + style tags + optional reference audio, using the vendored `heartlib` submodule, with a premium dark UI and SQLite-backed song library — without any accounts, telemetry, cloud sync, or auto-update.

### Concrete Deliverables
1. `audiomorph-studio.dmg` (macOS Apple Silicon, universal2 not required)
2. `AudioMorph Studio Setup.exe` (Windows x64 NSIS installer)
3. `AudioMorph-Studio.AppImage` + `audiomorph-studio_*.deb` (Linux x64)
4. Repo structure: `apps/desktop/` (Electron), `apps/web/` (Next.js renderer), `services/backend/` (FastAPI Python), `heartlib/` (submodule), `packaging/` (per-OS scripts), `.sisyphus/evidence/` (QA artifacts)
5. First-run wizard with hardware check + model storage selection + consented model download
6. FastAPI sidecar exposing: `POST /api/generate`, `GET /api/jobs/{id}`, `POST /api/jobs/{id}/cancel`, `GET /api/library`, `POST /api/export`, `POST /api/lyrics/llm`, `GET /api/health`, `GET /api/system/hardware`, `POST /api/settings/storage-path`, model download progress SSE stream
7. Frontend pages: `/` (generate), `/library`, `/settings`, `/first-run`
8. SQLite schema: `jobs`, `songs`, `favorites`, `settings`, `download_state`
9. Phase 0 artifacts: `docs/heartlib-api-contract.md`, `docs/wheel-matrix-verification.md`, `docs/ffmpeg-source-manifest.md`, `docs/pbs-platform-matrix.md`

### Definition of Done
- [ ] `bun run build:all` produces all 4 platform artifacts in `dist/` (verified on macOS arm64; cross-target verified via CI matrix in `.github/workflows/build.yml`)
- [ ] On macOS arm64 host: install `.dmg`, complete first-run wizard, generate a 30s song from prompt "lo-fi hip hop, rainy night", verify output WAV plays
- [ ] All 38 tasks have evidence files in `.sisyphus/evidence/`
- [ ] F1-F4 final verification wave: all APPROVE
- [ ] User explicitly approves

### Must Have
- All 9 MVP features functional on at least macOS Apple Silicon (CI-verified for Win/Linux)
- TDD: every task RED-GREEN-REFACTOR with `bun test` / `pytest` passing
- Hardware gate refuses install on unsupported platforms with clear error
- First-run wizard for storage location + consented model download with progress + cancel + SHA256 verification + resume
- Ephemeral sidecar port + shared-secret header
- OpenRouter API key in Electron `safeStorage`/keytar (NEVER SQLite plaintext)
- Sidecar PID tracked; SIGTERM on quit; zombie cleanup on next launch
- Generation job cancellable; OOM caught and reported to UI
- ffmpeg 8 bundled per-platform; fallback error if missing
- Waveform + live FFT spectrum at ≥55fps on M1 baseline
- OKLCH token coverage 100% (no raw hex/rgb in component code)
- WCAG AA contrast (4.5:1 normal text, 3:1 large) on all surfaces
- Phase 0 artifacts committed before any Wave 1 task starts

### Must NOT Have (Guardrails)
- ❌ Bundled HF model weights (always downloaded on first run with consent)
- ❌ Telemetry / analytics / crash reporters / any outbound network call except: HF Hub (model download), OpenRouter (BYOK lyrics)
- ❌ Auto-update mechanism (electron-updater MUST NOT be installed)
- ❌ User accounts / login / cloud sync / sharing endpoints
- ❌ API keys shipped in source (OpenRouter is BYOK; no fallback key)
- ❌ Plaintext API key storage (no `settings.openrouter_key` column in SQLite)
- ❌ UI blocking during generation (must be cancellable + show progress)
- ❌ Audio source separation features (vocal isolation, stem splitting)
- ❌ Multi-track DAW / per-stem mixing
- ❌ Real-time streaming generation (batch only)
- ❌ Concurrent generations (single job, queued in SQLite)
- ❌ YouTube/URL ingestion / vocal cloning / MIDI export
- ❌ Raw hex / `rgb()` / `rgba()` color literals in `apps/web/src/**` (OKLCH tokens only)
- ❌ `any` / `@ts-ignore` / `// eslint-disable` in production code
- ❌ `console.log` in production builds (use structured logger)
- ❌ CPU-only inference path (refuse install instead)
- ❌ Intel Mac, AMD GPU, ARM Linux non-Apple support in v1
- ❌ electron-updater, electron-reload-anything-after-install patterns
- ❌ Plan splitting (everything is in THIS plan; no "Phase 2 plan later")

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO (empty repo) → plan includes test infrastructure setup (W1.1, W1.2)
- **Automated tests**: YES (TDD)
- **Frameworks**:
  - Frontend / Electron: **bun test** (built-in, fast, TypeScript-native)
  - Backend: **pytest** with `pytest-asyncio` + `httpx` AsyncClient for FastAPI
  - E2E: **Playwright** against Electron via `@playwright/test` + `electron` fixture
- **TDD per task**: RED (failing test committed) → GREEN (minimal impl) → REFACTOR (clean while green)

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright (skill: `playwright`) — navigate, interact, assert DOM, screenshot
- **TUI/CLI**: `interactive_bash` (tmux) — run command, send keystrokes, validate output
- **API/Backend**: `Bash` + `curl` — POST/GET, assert status + JSON fields
- **Library/Module**: `Bash` running `bun`/`python` REPL — import, call, compare output
- **Electron-specific**: Playwright `_electron.launch()` fixture

---

## Execution Strategy

### Parallel Execution Waves

```
Phase 0 (Pre-Flight Verification — MUST complete before Wave 1):
├── P0.1: Verify python-build-standalone availability for Python 3.14 on 3 platforms [quick]
├── P0.2: Verify torch + torchcodec + torchtune + torchao cp314 wheel availability [quick]
├── P0.3: Verify ffmpeg 8 static binary sources for 3 platforms [quick]
└── P0.4: Document heartlib API contract from examples/ + src/heartlib/ [deep]

Wave 1 (Foundation + Scaffolding — after Phase 0):
├── W1.1: Monorepo scaffold (bun workspaces, root tsconfig, biome) [quick]
├── W1.2: Test infrastructure (bun test + pytest + Playwright Electron) [quick]
├── W1.3: Design system tokens (OKLCH palette + Geist + Tailwind config) [visual-engineering]
├── W1.4: SQLite schema + SQLModel models + migration runner [quick]
├── W1.5: Python sidecar bootstrap (FastAPI app + health endpoint + ephemeral port + shared-secret) [unspecified-high]
├── W1.6: Hardware detection module (GPU/OS/arch enumeration) [unspecified-high]
└── W1.7: Structured logger (pino frontend, structlog backend, file rotation) [quick]

Wave 2 (Backend Services — after Wave 1):
├── W2.1: heartlib adapter (wraps reverse-engineered API from P0.4) [deep]
├── W2.2: Model download service (huggingface_hub + SHA256 + resume + progress SSE) [unspecified-high]
├── W2.3: Generation service (job queue, cancel, OOM handling, progress) [deep]
├── W2.4: Quantization config (bitsandbytes int8/int4 gated by hardware) [unspecified-high]
├── W2.5: Library service (CRUD songs, favorites, regenerate) [quick]
├── W2.6: Export service (ffmpeg 8 WAV→FLAC/MP3 with error handling) [unspecified-high]
├── W2.7: OpenRouter LLM lyrics service (BYOK, retry, timeout) [quick]
└── W2.8: Settings service (storage path + lang + theme persistence) [quick]

Wave 3 (Frontend Modules — after Wave 1; can overlap with Wave 2):
├── W3.1: App shell (layout, nav, theme provider, a11y baseline) [visual-engineering]
├── W3.2: API client (typed fetch wrapper, SSE handler, secret-header injection) [quick]
├── W3.3: Zustand stores (generation, library, settings, downloads) [quick]
├── W3.4: First-run wizard (hardware check → storage path → model download) [visual-engineering]
├── W3.5: Generate page (prompt + lyrics + style tags + reference audio + params) [visual-engineering]
├── W3.6: Player component (wavesurfer.js v7 + Canvas FFT @ 55fps) [visual-engineering]
├── W3.7: Library page (grid, search, favorites, regenerate, delete) [visual-engineering]
└── W3.8: Settings page (storage path, OpenRouter key, language, theme) [visual-engineering]

Wave 4 (Electron Shell + Packaging — after Waves 2 & 3):
├── W4.1: Electron main process (BrowserWindow, contextBridge, secure defaults) [unspecified-high]
├── W4.2: Preload script (IPC bridge with allow-list) [quick]
├── W4.3: Python sidecar lifecycle (spawn, PID track, SIGTERM on quit, zombie cleanup) [deep]
├── W4.4: Static export integration (Next.js export → Electron file:// load) [quick]
├── W4.5: Secure key storage (safeStorage/keytar for OpenRouter key) [unspecified-high]
├── W4.6: extraResources layout (Python + heartlib + ffmpeg per-platform) [unspecified-high]
└── W4.7: electron-builder config (3-target matrix, asarUnpack, code-sign placeholders) [unspecified-high]

Wave 5 (Per-OS Installers + Hardware Gating — after Wave 4):
├── W5.1: macOS .dmg builder + hardware gate (refuses Intel Mac) [unspecified-high]
├── W5.2: Windows NSIS installer + hardware gate (refuses no-CUDA) [unspecified-high]
├── W5.3: Linux AppImage + .deb builder + hardware gate (refuses no-CUDA) [unspecified-high]
├── W5.4: GitHub Actions CI matrix (build 3 platforms) [quick]
└── W5.5: README + system requirements + install docs [writing]

Wave FINAL (After ALL implementation — 4 parallel reviews → user okay):
├── F1: Plan compliance audit [oracle]
├── F2: Code quality review [unspecified-high]
├── F3: Real manual QA via Playwright Electron [unspecified-high]
└── F4: Scope fidelity check [deep]
-> Present results -> Get explicit user okay

Critical Path: P0.4 → W1.5 → W2.1 → W2.3 → W3.6 → W4.3 → W5.1 → F1-F4 → user okay
Parallel Speedup: ~70% (6 waves vs ~38 sequential tasks)
Max Concurrent: 8 (Wave 3)
```

### Dependency Matrix (abbreviated; full matrix per task)

- **P0.1-P0.3**: independent — parallel
- **P0.4**: independent (read-only) — parallel with P0.1-P0.3 — blocks W2.1
- **W1.1**: blocks W1.2-W1.7
- **W1.5**: depends W1.1 — blocks W2.* + W4.3
- **W2.1**: depends P0.4, W1.5 — blocks W2.3
- **W2.3**: depends W2.1, W2.2, W2.4 — blocks W3.5, W4.3
- **W3.6**: depends W1.3, W3.2 — blocks F3
- **W4.3**: depends W1.5, W2.3 — blocks W5.*
- **W5.1-W5.3**: depends W4.6, W4.7 — blocks F1
- **F1-F4**: depend on ALL implementation — block user okay

### Agent Dispatch Summary

- **Phase 0**: 4 tasks — P0.1-P0.3 → `quick`, P0.4 → `deep`
- **Wave 1**: 7 tasks — W1.1, W1.2, W1.4, W1.7 → `quick`; W1.3 → `visual-engineering`; W1.5, W1.6 → `unspecified-high`
- **Wave 2**: 8 tasks — W2.1, W2.3 → `deep`; W2.2, W2.4, W2.6 → `unspecified-high`; W2.5, W2.7, W2.8 → `quick`
- **Wave 3**: 8 tasks — W3.1, W3.4-W3.8 → `visual-engineering`; W3.2, W3.3 → `quick`
- **Wave 4**: 7 tasks — W4.2, W4.4 → `quick`; W4.1, W4.3, W4.5, W4.6, W4.7 → `unspecified-high` (W4.3 → `deep`)
- **Wave 5**: 5 tasks — W5.1-W5.3 → `unspecified-high`; W5.4 → `quick`; W5.5 → `writing`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] P0.1. Verify python-build-standalone availability for Python 3.14 on 3 target platforms

  **What to do**:
  - Visit `https://github.com/astral-sh/python-build-standalone/releases/latest`
  - For Python 3.14.x, list available builds matching: `aarch64-apple-darwin-install_only.tar.gz`, `x86_64-pc-windows-msvc-install_only.tar.gz`, `x86_64-unknown-linux-gnu-install_only.tar.gz`
  - Download each, extract, run embedded `python --version` to confirm 3.14.x
  - Test `python -m pip install --upgrade pip` works against extracted runtime
  - Test `python -m pip install fastapi uvicorn` succeeds offline-after-cache
  - Write findings to `docs/pbs-platform-matrix.md` with version pins + download URLs + SHA256 hashes

  **Must NOT do**: Do NOT commit the downloaded PBS tarballs to git (multi-100MB); reference URLs only

  **Recommended Agent Profile**:
  - **Category**: `quick` — Verification + doc writing, no novel logic
  - **Skills**: `[]` — Pure verification, no domain skill needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Phase 0 (with P0.2, P0.3, P0.4)
  - **Blocks**: W1.5 (sidecar bootstrap needs PBS URLs), W4.6 (extraResources layout)
  - **Blocked By**: None — start immediately

  **References**:
  - External: `https://github.com/astral-sh/python-build-standalone/releases` — PBS releases (find latest 3.14.x)
  - External: `https://gregoryszorc.com/docs/python-build-standalone/main/` — PBS docs (install_only vs full)
  - WHY: Plan requires Python 3.14 bundled per-platform; PBS is the canonical solution used by `uv`. Without confirmed 3 platform tarballs, the entire packaging strategy breaks.

  **Acceptance Criteria**:
  - [ ] `docs/pbs-platform-matrix.md` exists with 3 rows (macos-arm64, win-x64, linux-x64), each containing: version, URL, SHA256, tested fastapi install result
  - [ ] `python --version` from each extracted runtime returns `Python 3.14.x`

  **QA Scenarios**:
  ```
  Scenario: PBS macOS arm64 runtime extracted and FastAPI installs
    Tool: Bash
    Preconditions: Clean /tmp/pbs-test/
    Steps:
      1. curl -L -o /tmp/pbs-test/macos.tar.gz "<URL from docs>"
      2. shasum -a 256 /tmp/pbs-test/macos.tar.gz  # assert matches docs SHA256
      3. tar -xzf /tmp/pbs-test/macos.tar.gz -C /tmp/pbs-test/
      4. /tmp/pbs-test/python/bin/python3 --version  # assert "Python 3.14"
      5. /tmp/pbs-test/python/bin/python3 -m pip install fastapi==0.115.0  # assert exit 0
    Expected Result: Python 3.14.x prints; pip install exits 0
    Failure Indicators: SHA mismatch, wrong version, pip install error
    Evidence: .sisyphus/evidence/task-P0.1-macos-pbs-verify.txt

  Scenario: docs/pbs-platform-matrix.md is complete
    Tool: Bash
    Preconditions: Plan task complete
    Steps:
      1. grep -c "^|" docs/pbs-platform-matrix.md  # assert ≥4 (header + 3 platforms)
      2. grep -E "macos-arm64|win-x64|linux-x64" docs/pbs-platform-matrix.md  # assert all 3
    Expected Result: All 3 platforms documented
    Evidence: .sisyphus/evidence/task-P0.1-doc-completeness.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-P0.1-macos-pbs-verify.txt`
  - [ ] `.sisyphus/evidence/task-P0.1-doc-completeness.txt`

  **Commit**: YES (standalone)
  - Message: `chore(phase0): verify python-build-standalone 3.14 availability`
  - Files: `docs/pbs-platform-matrix.md`
  - Pre-commit: `test -f docs/pbs-platform-matrix.md`

- [x] P0.2. Verify torch + torchcodec + torchtune + torchao + bitsandbytes cp314 wheel availability

  **What to do**:
  - For each package: `torch`, `torchcodec`, `torchtune`, `torchao`, `torchaudio`, `torchvision`, `bitsandbytes`, `transformers`, `accelerate`, `huggingface_hub`, `numpy`, `soundfile`, `modelscope`, `vector-quantize-pytorch`
  - Check PyPI `#files` table at `https://pypi.org/project/<pkg>/#files` for cp314 wheels matching: `macosx_*_arm64`, `manylinux*_x86_64`, `win_amd64`
  - Note version that first introduced cp314 support (or "no cp314 yet" if missing)
  - For missing packages, identify fallback: source-wheel buildable from PBS 3.14? Or pin to 3.12 fallback?
  - Write matrix to `docs/wheel-matrix-verification.md` with columns: pkg | required-version | cp314-macos-arm64 | cp314-win-amd64 | cp314-linux-x64 | fallback-plan
  - If ANY required package has no cp314 wheel AND no source-build fallback → flag BLOCKER in doc; trigger Round 4 user question

  **Must NOT do**: Do NOT install packages locally (waste of disk); inspect PyPI metadata only. Do NOT downgrade required versions silently — document mismatches.

  **Recommended Agent Profile**:
  - **Category**: `quick` — PyPI metadata inspection + tabulation
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Phase 0
  - **Blocks**: W2.1 (heartlib adapter needs torch import to work)
  - **Blocked By**: None

  **References**:
  - File: `heartlib/pyproject.toml` — required dep versions
  - External: `https://pypi.org/project/torch/#files`, `https://pypi.org/project/bitsandbytes/#files`, etc.
  - WHY: Metis flagged Python 3.14 wheel availability as #1 blocker. bitsandbytes 0.49.2 cp314 already verified by user; remaining packages must be confirmed before sidecar bootstrap, else fallback Python 3.12 must be invoked.

  **Acceptance Criteria**:
  - [ ] `docs/wheel-matrix-verification.md` exists with all 14 packages × 3 platforms
  - [ ] No "BLOCKER" row remains uncategorized (each is either confirmed cp314 OR has documented fallback)

  **QA Scenarios**:
  ```
  Scenario: All required packages have a documented cp314 status
    Tool: Bash
    Preconditions: Doc written
    Steps:
      1. grep -c "^| torch " docs/wheel-matrix-verification.md  # assert ≥1
      2. grep -c "^| bitsandbytes " docs/wheel-matrix-verification.md  # assert ≥1
      3. ! grep -i "UNKNOWN\|TBD\|FIXME" docs/wheel-matrix-verification.md  # assert no unknowns
    Expected Result: All packages tabulated, no TBDs
    Evidence: .sisyphus/evidence/task-P0.2-matrix-complete.txt

  Scenario: bitsandbytes cp314 confirmed (sanity)
    Tool: Bash
    Preconditions: Doc written
    Steps:
      1. grep "bitsandbytes" docs/wheel-matrix-verification.md | grep -E "cp314|3\.14"
    Expected Result: Row confirms cp314 support
    Evidence: .sisyphus/evidence/task-P0.2-bitsandbytes-sanity.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-P0.2-matrix-complete.txt`
  - [ ] `.sisyphus/evidence/task-P0.2-bitsandbytes-sanity.txt`

  **Commit**: YES (standalone)
  - Message: `chore(phase0): verify Python 3.14 wheel matrix for heartlib deps`
  - Files: `docs/wheel-matrix-verification.md`
  - Pre-commit: `test -f docs/wheel-matrix-verification.md`

- [x] P0.3. Verify ffmpeg 8.0 static build availability per platform

  **What to do**:
  - macOS arm64: download from `https://evermeet.cx/ffmpeg/` (latest 8.x); verify `ffmpeg -version` reports 8.x
  - Windows x64: download from `https://github.com/BtbN/FFmpeg-Builds/releases` (`ffmpeg-master-latest-win64-gpl.zip`); extract `ffmpeg.exe`, run `ffmpeg.exe -version`
  - Linux x64: download from BtbN (`ffmpeg-master-latest-linux64-gpl.tar.xz`); extract, run `ffmpeg -version`
  - For each: confirm codecs needed (libmp3lame, libfdk_aac optional, aac native, flac, wav PCM) via `ffmpeg -codecs | grep <codec>`
  - Document SHA256 + URLs + bundle size in `docs/ffmpeg-platform-matrix.md`

  **Must NOT do**: Do NOT commit ffmpeg binaries to git; reference only. Do NOT use system ffmpeg — must be portable static binary for installer bundling.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Phase 0
  - **Blocks**: W2.6 (export pipeline), W4.6 (extraResources)
  - **Blocked By**: None

  **References**:
  - External: `https://evermeet.cx/ffmpeg/`, `https://github.com/BtbN/FFmpeg-Builds/releases`
  - WHY: User specified ffmpeg 8; static builds required for installer bundling. Codec verification ensures export presets (MP3/AAC/FLAC/WAV) will work.

  **Acceptance Criteria**:
  - [ ] `docs/ffmpeg-platform-matrix.md` with 3 platforms × {URL, SHA256, size, codecs verified}
  - [ ] All 4 required codecs (libmp3lame, aac, flac, pcm_s16le) confirmed per platform

  **QA Scenarios**:
  ```
  Scenario: ffmpeg 8.x reports version on macOS arm64
    Tool: Bash
    Preconditions: Binary downloaded to /tmp/ffmpeg-test/
    Steps:
      1. /tmp/ffmpeg-test/ffmpeg -version 2>&1 | head -1
    Expected Result: Line contains "ffmpeg version 8."
    Evidence: .sisyphus/evidence/task-P0.3-macos-version.txt

  Scenario: All required codecs present
    Tool: Bash
    Preconditions: Binary downloaded
    Steps:
      1. /tmp/ffmpeg-test/ffmpeg -codecs 2>&1 | grep -E "libmp3lame|aac|flac|pcm_s16le" | wc -l
    Expected Result: Count ≥ 4
    Evidence: .sisyphus/evidence/task-P0.3-codecs.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-P0.3-macos-version.txt`
  - [ ] `.sisyphus/evidence/task-P0.3-codecs.txt`

  **Commit**: YES
  - Message: `chore(phase0): verify ffmpeg 8 static builds per platform`
  - Files: `docs/ffmpeg-platform-matrix.md`
  - Pre-commit: `test -f docs/ffmpeg-platform-matrix.md`

- [x] P0.4. Reverse-engineer heartlib music generation + lyrics transcription API surface

  **What to do**:
  - Read `heartlib/examples/run_music_generation.py` end-to-end; document: class names, constructor params, generate() signature, input format, output format (tensor shape, sample rate, channels), required device handling, memory cleanup
  - Read `heartlib/examples/run_lyrics_transcription.py`; document same surface
  - Inspect `heartlib/src/heartlib/` modules to map: model loaders, tokenizers, codec encoder/decoder
  - Identify all hardcoded paths/configs that must become configurable in our adapter
  - Document model file requirements: which HF repos, expected directory layout, expected filenames
  - Write to `docs/heartlib-api-surface.md` with Python-style pseudocode showing exact adapter interface
  - Note all `mmgp` usage (memory management library); decide vendor-or-skip

  **Must NOT do**: Do NOT modify heartlib (it's a submodule); read-only inspection. Do NOT execute generation (no GPU available in plan phase).

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reverse engineering requires careful reading + cross-referencing
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Phase 0
  - **Blocks**: W2.1 (heartlib adapter), W2.3 (generation endpoint), W2.4 (lyrics endpoint)
  - **Blocked By**: None

  **References**:
  - File: `heartlib/examples/run_music_generation.py` — primary generation example
  - File: `heartlib/examples/run_lyrics_transcription.py` — lyrics example
  - File: `heartlib/src/heartlib/` — module internals
  - File: `heartlib/pyproject.toml` — dependency declarations
  - WHY: User chose "reverse engineer the examples/" over reading README. Adapter cannot be built until exact API contract is documented. This is the foundation for ALL backend logic.

  **Acceptance Criteria**:
  - [ ] `docs/heartlib-api-surface.md` documents: music gen entry point, lyrics entry point, model file layout, all required HF repos, mmgp decision
  - [ ] Pseudocode for adapter wrapper functions: `generate_music(prompt, lyrics, duration, seed, ...) -> bytes`, `transcribe_lyrics(audio_bytes) -> str`

  **QA Scenarios**:
  ```
  Scenario: API surface doc covers both flows
    Tool: Bash
    Preconditions: Doc written
    Steps:
      1. grep -E "generate_music|MusicGen|music_generation" docs/heartlib-api-surface.md | wc -l  # ≥3
      2. grep -E "transcribe|lyrics|whisper" docs/heartlib-api-surface.md | wc -l  # ≥3
      3. grep -E "HeartMuLa/" docs/heartlib-api-surface.md | wc -l  # ≥3 (3 HF repos)
    Expected Result: All conditions met
    Evidence: .sisyphus/evidence/task-P0.4-doc-coverage.txt

  Scenario: mmgp decision recorded
    Tool: Bash
    Preconditions: Doc written
    Steps:
      1. grep -i "mmgp" docs/heartlib-api-surface.md
    Expected Result: Decision present (vendor / skip / replace)
    Evidence: .sisyphus/evidence/task-P0.4-mmgp-decision.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-P0.4-doc-coverage.txt`
  - [ ] `.sisyphus/evidence/task-P0.4-mmgp-decision.txt`

  **Commit**: YES
  - Message: `docs(phase0): document heartlib API surface for adapter`
  - Files: `docs/heartlib-api-surface.md`
  - Pre-commit: `test -f docs/heartlib-api-surface.md`

- [x] W1.1. Initialize monorepo workspace structure with pnpm + Python uv

  **What to do**:
  - Create root `package.json` with `"private": true`, `"packageManager": "pnpm@9.x"`, and workspaces: `["apps/desktop", "apps/web", "packages/*"]`
  - Create `pnpm-workspace.yaml` mirroring the workspaces
  - Create directories: `apps/desktop/` (Electron shell), `apps/web/` (Next.js frontend), `apps/sidecar/` (Python backend), `packages/shared-types/` (TS+Python type contracts), `packages/ui/` (shared shadcn components)
  - Create root `.gitignore`: `node_modules/`, `.next/`, `dist/`, `out/`, `*.log`, `.env*`, `__pycache__/`, `.venv/`, `.uv-cache/`, `.sisyphus/evidence/`, `release/`
  - Create root `README.md` (≤30 lines) with: project name, one-line description, build instructions stub, license MIT
  - Create `apps/sidecar/pyproject.toml` using `uv init --package` style with `requires-python = ">=3.14,<3.15"`
  - Create root `.editorconfig`, `.nvmrc` (node 22), `.tool-versions` (python 3.14)
  - Run `pnpm install` to generate `pnpm-lock.yaml`

  **Must NOT do**: Do NOT add app-specific code yet (those are in W1.2+). Do NOT commit `node_modules` or `.venv`. Do NOT use npm or yarn (pnpm only).

  **Recommended Agent Profile**:
  - **Category**: `quick` — Scaffolding only
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (root of dependency tree)
  - **Parallel Group**: Wave 1 entry (sequential before W1.2-W1.7)
  - **Blocks**: ALL subsequent tasks (entire repo depends on this)
  - **Blocked By**: All Phase 0 tasks

  **References**:
  - File: `package.json` (does not exist yet) — must be created
  - External: `https://pnpm.io/workspaces` — pnpm workspace config
  - External: `https://docs.astral.sh/uv/concepts/projects/` — uv project init
  - WHY: User stipulated TS frontend + Python backend + Electron shell. Monorepo is the only sane way to coordinate; pnpm workspaces are the lightweight standard. `uv` is the canonical Python project manager for 2025+ and handles Python 3.14 well.

  **Acceptance Criteria**:
  - [ ] `pnpm install` exits 0
  - [ ] `pnpm -r exec pwd` lists all 5 workspaces
  - [ ] `git status` shows clean tree after `.gitignore` applied
  - [ ] `apps/sidecar/pyproject.toml` declares `requires-python = ">=3.14,<3.15"`

  **QA Scenarios**:
  ```
  Scenario: Workspace structure is complete and pnpm recognizes all packages
    Tool: Bash
    Preconditions: Phase 0 complete, clean repo
    Steps:
      1. pnpm install --frozen-lockfile=false 2>&1 | tee /tmp/pnpm.log
      2. test -f pnpm-lock.yaml && echo "lockfile exists"
      3. pnpm -r exec pwd | sort > /tmp/workspaces.txt
      4. wc -l /tmp/workspaces.txt  # assert ≥5
      5. cat /tmp/workspaces.txt | grep -E "apps/desktop|apps/web|apps/sidecar|packages/shared-types|packages/ui"
    Expected Result: All 5 workspaces enumerated, lockfile generated
    Failure Indicators: Missing workspace, pnpm install fails, lockfile absent
    Evidence: .sisyphus/evidence/task-W1.1-workspace-structure.txt

  Scenario: Python sidecar pyproject pins 3.14
    Tool: Bash
    Preconditions: Scaffolding complete
    Steps:
      1. grep -E 'requires-python.*3\.14' apps/sidecar/pyproject.toml
    Expected Result: Match found
    Evidence: .sisyphus/evidence/task-W1.1-python-version.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-W1.1-workspace-structure.txt`
  - [ ] `.sisyphus/evidence/task-W1.1-python-version.txt`

  **Commit**: YES
  - Message: `chore(scaffold): initialize pnpm + uv monorepo workspace`
  - Files: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `README.md`, `.editorconfig`, `.nvmrc`, `.tool-versions`, `apps/sidecar/pyproject.toml`, `apps/*/`, `packages/*/`
  - Pre-commit: `pnpm install --frozen-lockfile`

- [x] W1.2. Define shared TypeScript + Python type contracts in packages/shared-types

  **What to do**:
  - In `packages/shared-types/`, create `package.json` with name `@audiomorph/shared-types`, main `dist/index.js`, types `dist/index.d.ts`
  - Create `src/index.ts` defining TS types: `GenerationRequest`, `GenerationStatus`, `GenerationResult`, `LyricsRequest`, `LyricsResult`, `ModelInfo`, `ExportRequest`, `ExportFormat`, `JobStatus` (enum: queued|running|completed|failed|cancelled), `AppSettings`, `ApiError`
  - Create `src/python_gen.ts` script: reads TS types via `ts-morph`, emits Python `pydantic.BaseModel` equivalents to `apps/sidecar/src/audiomorph/schemas.py`
  - Add `tsconfig.json` extending root config; build with `tsc`
  - Add npm scripts: `build`, `gen:python`, `test`
  - Write `src/__tests__/contracts.test.ts` (RED): verify all required fields present on `GenerationRequest` (prompt, lyrics, duration_seconds, seed, model_id), `JobStatus` enum has exactly 5 values
  - Implement types (GREEN) until tests pass
  - Run `pnpm gen:python` and commit generated `schemas.py`

  **Must NOT do**: Do NOT define backend-specific types here (DB models, internal state). Only over-the-wire DTOs. Do NOT use `any` or `unknown` in public surface.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with W1.3, W1.4, W1.6, W1.7)
  - **Blocks**: W2.1 (sidecar uses generated pydantic), W3.5 (frontend API client uses TS types)
  - **Blocked By**: W1.1

  **References**:
  - File: `docs/heartlib-api-surface.md` (from P0.4) — drives `GenerationRequest` fields
  - External: `https://docs.pydantic.dev/2.10/` — Pydantic v2 model patterns
  - External: `https://ts-morph.com/` — TS AST traversal for codegen
  - WHY: Type contracts are the single source of truth across the TS/Python boundary. Generating Pydantic from TS prevents drift. Metis flagged "no contract layer" as high-priority gap.

  **Acceptance Criteria**:
  - [ ] `pnpm --filter @audiomorph/shared-types test` → all green
  - [ ] `pnpm --filter @audiomorph/shared-types build` → emits `dist/index.{js,d.ts}`
  - [ ] `pnpm --filter @audiomorph/shared-types gen:python` → writes `apps/sidecar/src/audiomorph/schemas.py`
  - [ ] Generated `schemas.py` imports successfully: `python -c "from audiomorph.schemas import GenerationRequest"`

  **QA Scenarios**:
  ```
  Scenario: TS types compile and tests pass (RED→GREEN)
    Tool: Bash
    Preconditions: W1.1 complete
    Steps:
      1. pnpm --filter @audiomorph/shared-types test 2>&1 | tee /tmp/types-test.log
      2. grep -E "passed|✓" /tmp/types-test.log
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-W1.2-ts-tests.txt

  Scenario: Generated Python schemas import successfully
    Tool: Bash
    Preconditions: gen:python ran
    Steps:
      1. cd apps/sidecar && uv run python -c "from audiomorph.schemas import GenerationRequest, JobStatus; r = GenerationRequest(prompt='test', lyrics='', duration_seconds=30, seed=42, model_id='test'); print(r.model_dump_json())"
    Expected Result: JSON printed without exception
    Failure Indicators: ImportError, ValidationError, missing field
    Evidence: .sisyphus/evidence/task-W1.2-python-import.txt

  Scenario: TS type drift detection (negative)
    Tool: Bash
    Preconditions: Generated schemas exist
    Steps:
      1. Manually delete a field from src/index.ts
      2. pnpm --filter @audiomorph/shared-types gen:python
      3. diff -q apps/sidecar/src/audiomorph/schemas.py <(git show HEAD:apps/sidecar/src/audiomorph/schemas.py)
    Expected Result: Diff is non-empty (drift detected)
    Evidence: .sisyphus/evidence/task-W1.2-drift-detection.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-W1.2-ts-tests.txt`
  - [ ] `.sisyphus/evidence/task-W1.2-python-import.txt`
  - [ ] `.sisyphus/evidence/task-W1.2-drift-detection.txt`

  **Commit**: YES
  - Message: `feat(types): TS+Python shared contracts with codegen`
  - Files: `packages/shared-types/**`, `apps/sidecar/src/audiomorph/schemas.py`
  - Pre-commit: `pnpm --filter @audiomorph/shared-types test && pnpm --filter @audiomorph/shared-types build`

- [x] W1.3. Define error envelope contract + structured logging conventions

  **What to do**: In `packages/shared-types/src/errors.ts`, define `ApiError` with `{code, message, details?, retriable, hint?}`; define `ErrorCode` string enum covering: VALIDATION_ERROR, MODEL_NOT_FOUND, GPU_UNAVAILABLE, OUT_OF_MEMORY, SIDECAR_DOWN, JOB_NOT_FOUND, CANCELLED, EXPORT_FAILED, DOWNLOAD_FAILED, KEY_VAULT_ERROR, INTERNAL_ERROR. Document mapping to HTTP status in `docs/error-envelope.md`. Add Python `ApiError` Pydantic model in regen output. Write test `errors.test.ts` (RED) asserting all 11 codes are exported and each has a documented HTTP status.

  **Must NOT do**: No domain-specific error subclasses here; one envelope only. No stack traces in `message` field (those go in `details` server-side).

  **Recommended Agent Profile**: `quick`, skills `[]`

  **Parallelization**: YES. Wave 1 group. Blocks W2.1, W2.3, W4.3. Blocked by W1.1.

  **References**: `packages/shared-types/src/index.ts` (extend), `docs/heartlib-api-surface.md` (P0.4 — list failure modes). WHY: Metis flagged "no unified error model" as high gap; without this every endpoint invents its own shape.

  **Acceptance Criteria**: `pnpm --filter @audiomorph/shared-types test` green; `docs/error-envelope.md` maps all 11 codes to HTTP status.

  **QA Scenarios**:
  ```
  Scenario: All error codes documented with HTTP status
    Tool: Bash
    Steps:
      1. for code in VALIDATION_ERROR MODEL_NOT_FOUND GPU_UNAVAILABLE OUT_OF_MEMORY SIDECAR_DOWN JOB_NOT_FOUND CANCELLED EXPORT_FAILED DOWNLOAD_FAILED KEY_VAULT_ERROR INTERNAL_ERROR; do grep -q "$code" docs/error-envelope.md || { echo "MISSING: $code"; exit 1; }; done
    Expected: All present, exit 0
    Evidence: .sisyphus/evidence/task-W1.3-error-coverage.txt
  ```

  **Commit**: YES. `feat(types): unified ApiError envelope + error code catalog`. Files: `packages/shared-types/src/errors.ts`, `docs/error-envelope.md`. Pre-commit: `pnpm --filter @audiomorph/shared-types test`.

- [x] W1.4. Centralize app paths + platform detection helpers

  **What to do**: Create `packages/platform/` package with TS exports `getUserDataDir()`, `getModelsDir()`, `getLogsDir()`, `getCacheDir()`, `getPlatform()` (returns `'darwin-arm64'|'win32-x64'|'linux-x64'`), `getDefaultModelsDir()`. Use Electron `app.getPath('userData')` when in main, fall back to env-derived paths in renderer/tests. Mirror in Python: `apps/sidecar/src/audiomorph/paths.py` using `platformdirs` library, exposing same 5 functions. Write RED tests for both — assert paths exist after `ensureDir()` and resolve to OS-correct locations (`~/Library/Application Support/AudioMorph Studio/` on macOS, `%APPDATA%\AudioMorph Studio\` on Windows, `~/.config/audiomorph-studio/` on Linux).

  **Must NOT do**: Do NOT hardcode paths anywhere else in the codebase — all path resolution must go through this package. Do NOT use `os.homedir()` directly.

  **Recommended Agent Profile**: `quick`, skills `[]`

  **Parallelization**: YES. Wave 1. Blocks W2.2 (model download dir), W2.5 (jobs DB path), W4.2 (sidecar launch). Blocked by W1.1.

  **References**: External `https://www.electronjs.org/docs/latest/api/app#appgetpathname`, `https://pypi.org/project/platformdirs/`. WHY: Metis flagged "scattered path logic" as common cross-platform bug source. Centralizing now prevents 20+ later fixes.

  **Acceptance Criteria**: Both TS and Python tests pass; same 5 functions in both languages; paths comply with OS conventions.

  **QA Scenarios**:
  ```
  Scenario: macOS paths follow Apple conventions
    Tool: Bash (on macOS)
    Steps:
      1. pnpm --filter @audiomorph/platform test 2>&1 | grep -E "darwin.*Application Support"
      2. cd apps/sidecar && uv run python -c "from audiomorph.paths import getUserDataDir; p=getUserDataDir(); assert 'Application Support' in str(p), p; print(p)"
    Expected: Both resolve to ~/Library/Application Support/AudioMorph Studio
    Evidence: .sisyphus/evidence/task-W1.4-macos-paths.txt
  ```

  **Commit**: YES. `feat(platform): cross-platform path resolution (TS+Python)`. Files: `packages/platform/**`, `apps/sidecar/src/audiomorph/paths.py`. Pre-commit: `pnpm --filter @audiomorph/platform test`.

- [x] W1.5. **[HIGH-RISK]** Sidecar bootstrap: discoverable Python runtime + port allocation + handshake

  **What to do**:
  - Create `apps/sidecar/src/audiomorph/__main__.py` accepting CLI flags: `--port=0` (request OS-assigned), `--host=127.0.0.1` (always loopback), `--parent-pid=<pid>` (parent watchdog), `--handshake-fd=<fd>` (write port+token to fd after bind, or `--handshake-file=<path>` on Windows), `--auth-token=<random-32-bytes-hex>` (required on every request)
  - Use `uvicorn.Server` programmatically; bind socket first to discover assigned port, then write `{"port":N,"token":"...","pid":N}` JSON to handshake fd/file, then `server.run()`
  - Install parent-watchdog: spawn thread that polls `os.getppid()` (Unix) or `psutil.pid_exists(parent_pid)` (Windows) every 1s; if parent dies, call `server.should_exit=True` + `sys.exit(0)` within 2s
  - Install signal handlers: SIGTERM/SIGINT → graceful 5s drain → forced exit; SIGHUP ignored
  - Auth middleware: reject requests missing `X-Audiomorph-Token: <auth-token>` header with 401 + `ApiError(code=KEY_VAULT_ERROR)`
  - On Windows: create job object via `pywin32` so child cannot survive parent kill; on Unix: `prctl(PR_SET_PDEATHSIG, SIGTERM)` via `ctypes`
  - Write integration test that: spawns sidecar via subprocess, reads handshake, makes authed request to `/healthz` (returns `{ok:true, version, gpu:{...}}`), verifies 401 on unauthed request, kills parent PID, asserts sidecar process exits within 3s
  - Document protocol in `docs/sidecar-protocol.md`

  **Must NOT do**:
  - Do NOT bind to `0.0.0.0` or any non-loopback address (security)
  - Do NOT use fixed port (collision with other Electron apps using same trick)
  - Do NOT log the auth token to stdout/stderr/files
  - Do NOT use HTTP basic auth, query-string auth, or any in-URL secret
  - Do NOT skip the parent-watchdog — leftover zombie processes are the #1 user complaint for Electron+Python apps

  **Recommended Agent Profile**:
  - **Category**: `deep` — Concurrency, OS signals, security boundary all converge here
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (independent of W1.2-W1.4)
  - **Parallel Group**: Wave 1
  - **Blocks**: W2.1, W2.3, W4.2, W4.3 (entire backend + Electron lifecycle)
  - **Blocked By**: W1.1, P0.2 (needs verified wheels), P0.4 (needs heartlib surface)

  **References**:
  - File: `apps/sidecar/pyproject.toml` (W1.1) — fastapi + uvicorn + psutil + pywin32 platform-conditional dep
  - File: `docs/error-envelope.md` (W1.3) — auth failure uses KEY_VAULT_ERROR
  - External: `https://www.uvicorn.org/server-behavior/` — programmatic uvicorn embedding
  - External: `https://github.com/electron/electron/issues/16395` — child process cleanup pitfalls (cautionary tale)
  - External: `https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects` — Windows job objects
  - WHY: Metis flagged "sidecar zombies on parent crash" + "port collision on multi-instance launch" as TWO of the top-5 blocking gaps. Both must be solved at the bootstrap layer; retrofitting later is painful. The handshake-on-fd pattern (instead of stdout parsing) is the only reliable way for Electron to know when sidecar is ready.

  **Acceptance Criteria**:
  - [ ] `apps/sidecar/src/audiomorph/__main__.py` exists and accepts all 5 CLI flags
  - [ ] Integration test passes: spawn → handshake → authed /healthz → 401 on unauth → parent-kill → child exits ≤3s
  - [ ] `docs/sidecar-protocol.md` documents handshake format, auth header, lifecycle, signals
  - [ ] No literal port number in source code (assert via grep)
  - [ ] Auth token never appears in any log file (assert via grep over /tmp/sidecar.log after test)

  **QA Scenarios**:
  ```
  Scenario: Full lifecycle — spawn, handshake, authed request, parent-kill cleanup
    Tool: Bash
    Preconditions: W1.1 done, uv sync ran, .venv populated
    Steps:
      1. cd apps/sidecar
      2. python3 -c "
import subprocess, json, os, signal, time, urllib.request, secrets, sys
token = secrets.token_hex(16)
r,w = os.pipe()
p = subprocess.Popen([sys.executable,'-m','audiomorph','--port=0','--host=127.0.0.1',f'--parent-pid={os.getpid()}',f'--handshake-fd={w}',f'--auth-token={token}'], pass_fds=(w,))
os.close(w)
hs = json.loads(os.read(r,4096))
print('handshake:',hs)
assert hs['port']>1024 and hs['port']<65536
# authed healthz
req = urllib.request.Request(f'http://127.0.0.1:{hs[\"port\"]}/healthz', headers={'X-Audiomorph-Token':token})
resp = urllib.request.urlopen(req,timeout=5).read()
print('healthz:',resp)
# unauth must 401
try:
  urllib.request.urlopen(f'http://127.0.0.1:{hs[\"port\"]}/healthz',timeout=5)
  raise SystemExit('FAIL: unauth allowed')
except urllib.error.HTTPError as e:
  assert e.code==401, e.code
# kill parent simulation — kill child directly to simulate watchdog reaction
p.terminate(); p.wait(timeout=5)
print('OK')
" 2>&1 | tee /tmp/w1.5-lifecycle.txt
      3. grep "OK" /tmp/w1.5-lifecycle.txt
    Expected: 'OK' printed; healthz returns 200 with json; unauth returns 401
    Failure Indicators: handshake never received, process hangs after parent kill, unauth succeeded, port < 1024
    Evidence: .sisyphus/evidence/task-W1.5-lifecycle.txt

  Scenario: Auth token never logged (security)
    Tool: Bash
    Preconditions: Sidecar ran with --log-file=/tmp/sidecar.log
    Steps:
      1. TOKEN=$(openssl rand -hex 16)
      2. (run sidecar briefly with $TOKEN, then terminate)
      3. ! grep -F "$TOKEN" /tmp/sidecar.log  # assert NOT found
    Expected: Token absent from log
    Evidence: .sisyphus/evidence/task-W1.5-token-leak-check.txt

  Scenario: No hardcoded port (negative)
    Tool: Bash
    Steps:
      1. ! grep -rE "port\s*=\s*[0-9]{4,5}" apps/sidecar/src/audiomorph/__main__.py
    Expected: No hits
    Evidence: .sisyphus/evidence/task-W1.5-no-hardcoded-port.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-W1.5-lifecycle.txt`
  - [ ] `.sisyphus/evidence/task-W1.5-token-leak-check.txt`
  - [ ] `.sisyphus/evidence/task-W1.5-no-hardcoded-port.txt`

  **Commit**: YES
  - Message: `feat(sidecar): bootstrap with port-discovery handshake + parent watchdog + auth`
  - Files: `apps/sidecar/src/audiomorph/__main__.py`, `apps/sidecar/src/audiomorph/_watchdog.py`, `apps/sidecar/src/audiomorph/_auth.py`, `apps/sidecar/tests/test_lifecycle.py`, `docs/sidecar-protocol.md`
  - Pre-commit: `cd apps/sidecar && uv run pytest tests/test_lifecycle.py`

- [x] W1.6. Configure ESLint, Prettier, Ruff, Pyright with shared root configs

  **What to do**: Add root `eslint.config.js` (flat config), `prettier.config.js`, `apps/sidecar/ruff.toml` (line-length 100, target py314, full rule set ALL minus D), `apps/sidecar/pyrightconfig.json` (strict mode, venvPath, pythonVersion 3.14). Wire up `pnpm lint`, `pnpm format`, `pnpm typecheck` at root (recursive). Add `.husky/pre-commit` running `pnpm lint-staged` (formats only staged files). Write RED test in each package that asserts no lint/type errors on the empty scaffold.

  **Must NOT do**: Do NOT disable rules globally to make existing code pass — fix the code. Do NOT add `// eslint-disable` or `# noqa` without code-review-style justification comment.

  **Recommended Agent Profile**: `quick`, skills `[]`

  **Parallelization**: YES. Wave 1. Blocks nothing critical but should land before W2+W3 to enforce style from the start. Blocked by W1.1.

  **References**: External `https://eslint.org/docs/latest/use/configure/configuration-files-new`, `https://docs.astral.sh/ruff/`, `https://microsoft.github.io/pyright/`. WHY: Without strict linting from day 1, AI-generated code accumulates `any`, dead imports, console.logs. Cheap to set up now, expensive to retrofit.

  **Acceptance Criteria**: `pnpm lint && pnpm typecheck` exit 0 on clean repo; `cd apps/sidecar && uv run ruff check . && uv run pyright` exit 0; pre-commit hook blocks unformatted commits.

  **QA Scenarios**:
  ```
  Scenario: Linters reject obviously bad code (negative)
    Tool: Bash
    Steps:
      1. echo "const x: any = 1; console.log(x);" > /tmp/bad.ts
      2. pnpm exec eslint /tmp/bad.ts 2>&1 | grep -E "no-explicit-any|no-console"
    Expected: Both rules fire
    Evidence: .sisyphus/evidence/task-W1.6-lint-rejection.txt
  ```

  **Commit**: YES. `chore(quality): configure eslint+prettier+ruff+pyright + pre-commit hook`. Files: `eslint.config.js`, `prettier.config.js`, `apps/sidecar/ruff.toml`, `apps/sidecar/pyrightconfig.json`, `.husky/**`, `package.json` (scripts). Pre-commit: `pnpm lint && pnpm typecheck`.

- [x] W1.7. Wire up Vitest (TS) + pytest (Python) test harnesses with CI-friendly output

  **What to do**: Add root Vitest config (`vitest.config.ts`) with workspace mode covering all `packages/*` and `apps/web`. Configure JUnit XML reporter to `.test-results/vitest.xml`. Configure pytest in `apps/sidecar/pyproject.toml` `[tool.pytest.ini_options]`: testpaths=tests, addopts=`-q --strict-markers --junit-xml=.test-results/pytest.xml`. Add `pnpm test` at root running both (`pnpm -r test && cd apps/sidecar && uv run pytest`). Write 1 trivial green test per package to verify wiring.

  **Must NOT do**: Do NOT use Jest (deprecated in this stack). Do NOT skip the JUnit reporter — CI integration depends on it.

  **Recommended Agent Profile**: `quick`, skills `[]`

  **Parallelization**: YES. Wave 1. Blocks nothing critical but needed for all RED-GREEN-REFACTOR work in Waves 2+. Blocked by W1.1.

  **References**: External `https://vitest.dev/guide/workspace.html`, `https://docs.pytest.org/en/stable/`. WHY: TDD mandate requires test runners ready before any RED test gets written.

  **Acceptance Criteria**: `pnpm test` exit 0 on scaffold; JUnit XML files produced.

  **QA Scenarios**:
  ```
  Scenario: Test runners produce JUnit output
    Tool: Bash
    Steps:
      1. pnpm test
      2. test -f .test-results/vitest.xml && test -f apps/sidecar/.test-results/pytest.xml
    Expected: Both XMLs exist
    Evidence: .sisyphus/evidence/task-W1.7-junit-output.txt
  ```

  **Commit**: YES. `chore(test): wire vitest+pytest with JUnit reporters`. Files: `vitest.config.ts`, `apps/sidecar/pyproject.toml`, `package.json`. Pre-commit: `pnpm test`.

- [x] W2.1. FastAPI app skeleton with global error handler + request logging

  **What to do**: Create `apps/sidecar/src/audiomorph/app.py` exporting `create_app() -> FastAPI`. Mount routers (placeholders for `/models`, `/jobs`, `/lyrics`, `/export`, `/settings`). Global exception handler: catch `ApiError` subclasses → return JSON envelope per W1.3 with correct HTTP status; catch `Exception` → log full traceback, return `INTERNAL_ERROR` envelope (no traceback in response). Mount auth middleware from W1.5. Add `/healthz` returning `{ok, version, gpu:{available, name?, vram_gb?}, models_dir, python_version}`. Request-logging middleware: log `{method, path, status, duration_ms, request_id}` as JSON line via structlog. Wire CORS for `http://localhost:*` only (Electron dev). Write RED tests asserting: ApiError → correct envelope; uncaught Exception → INTERNAL_ERROR; /healthz returns gpu info; auth required on non-healthz routes.

  **Must NOT do**: No `print()` — structlog only. No stack traces in API responses. No CORS wildcard. No unauthenticated routes except /healthz.

  **Recommended Agent Profile**: `deep`, skills `[]`

  **Parallelization**: NO with W1.5 (depends), YES with W2.4-W2.8. Wave 2 entry task. Blocks W2.3-W2.8. Blocked by W1.5, W1.3, W1.2.

  **References**: External `https://fastapi.tiangolo.com/tutorial/handling-errors/`, `https://www.structlog.org/`. WHY: Every endpoint added later needs consistent error/log behavior — establishing here prevents drift.

  **Acceptance Criteria**: All RED tests green; `/healthz` returns gpu detection; logs are valid JSON lines.

  **QA Scenarios**:
  ```
  Scenario: Healthz reports GPU state correctly
    Tool: Bash
    Steps:
      1. (spawn sidecar with auth) ; curl -sH "X-Audiomorph-Token: $TOKEN" http://127.0.0.1:$PORT/healthz | jq .
      2. python3 -c "import json,sys; d=json.load(sys.stdin); assert 'gpu' in d and 'available' in d['gpu']" < /tmp/healthz.json
    Expected: gpu.available is boolean; on macOS arm64 gpu.name contains 'Apple'; on CUDA host gpu.name contains 'NVIDIA'
    Evidence: .sisyphus/evidence/task-W2.1-healthz.txt

  Scenario: Uncaught exception returns INTERNAL_ERROR without traceback
    Tool: Bash
    Steps:
      1. Add temporary /debug-boom route that raises ValueError("secret-trace-marker")
      2. curl response body
      3. ! grep "secret-trace-marker" /tmp/response.json
      4. grep "INTERNAL_ERROR" /tmp/response.json
    Expected: Marker absent from response, present in server log
    Evidence: .sisyphus/evidence/task-W2.1-exception-handling.txt
  ```

  **Commit**: YES. `feat(api): FastAPI app with error envelope + structlog + healthz`. Files: `apps/sidecar/src/audiomorph/app.py`, `apps/sidecar/src/audiomorph/_logging.py`, `apps/sidecar/tests/test_app.py`. Pre-commit: `cd apps/sidecar && uv run pytest`.

- [x] W2.2. **[HIGH-RISK]** Model download manager: HF hub integration with resume, SHA256, concurrency cap, BYOK token

  **What to do**:
  - Implement `apps/sidecar/src/audiomorph/models/manager.py`:
    - `list_required_models() -> [ModelInfo]` returning the 3 HF repos (`HeartMuLa/HeartMuLaGen`, `HeartMuLa/HeartMuLa-oss-3B-happy-new-year`, `HeartMuLa/HeartCodec-oss-20260123`) with expected file lists + per-file SHA256 from HF API
    - `get_status(model_id) -> {state: missing|partial|verified|corrupted, bytes_done, bytes_total, files: [...]}`
    - `start_download(model_id) -> job_id` — runs in background asyncio task, uses `huggingface_hub.snapshot_download(resume_download=True, max_workers=4, etag_timeout=30, local_dir=<models_dir>/<repo_id>)`; honors `HF_TOKEN` env var if set (BYOK gated read), else anonymous
    - `cancel_download(job_id)` — sets cancel flag, lets in-flight chunk finish, marks state partial
    - `verify(model_id) -> {valid: bool, mismatches: [filepath]}` — recomputes SHA256 of each file vs HF-published expected hash, in parallel via `concurrent.futures.ThreadPoolExecutor(4)`
    - `delete(model_id)` — rm -rf model dir
  - Endpoints in `routers/models.py`:
    - `GET /models` → list with status
    - `POST /models/{id}/download` → returns job_id
    - `DELETE /models/{id}/download/{job_id}` → cancel
    - `POST /models/{id}/verify` → returns verify result
    - `DELETE /models/{id}` → returns 204
    - `GET /models/jobs/{job_id}/events` → SSE stream of `{bytes_done, bytes_total, current_file, speed_mbps}`
  - Concurrency: max 1 download job in flight globally (queue further requests) to prevent disk thrash + HF rate limits
  - Disk-space pre-check: before starting, query free space at models_dir; refuse if free < (total_bytes * 1.2); raise `ApiError(code=DOWNLOAD_FAILED, hint="Need X GB free")`
  - Tests (RED first):
    - Resume: simulate partial file (truncate to 50%), call start_download, assert it resumes from offset (mock HF endpoint via `respx`)
    - SHA256 mismatch: write a file with wrong content, call verify, assert returns `mismatches: [...]`
    - Cancel: start download, cancel after 100ms, assert state=partial within 2s
    - Disk-full: monkeypatch `shutil.disk_usage` to return 1MB free, assert DOWNLOAD_FAILED
    - BYOK: set HF_TOKEN, assert request includes `Authorization: Bearer ...`

  **Must NOT do**:
  - Do NOT store HF_TOKEN in SQLite or any file — env var only, passed at sidecar spawn time from Electron keytar
  - Do NOT use `git lfs clone` (slow, no resume granularity)
  - Do NOT allow concurrent downloads of the same model (lock per repo)
  - Do NOT download outside `<models_dir>/<repo_id>/` — validate paths against directory traversal
  - Do NOT log the HF token

  **Recommended Agent Profile**:
  - **Category**: `deep` — Resume + SHA + concurrency + cancel + auth all in one
  - **Skills**: `[]`

  **Parallelization**: YES with W2.3-W2.8. Wave 2. Blocks W3.3 (model UI). Blocked by W2.1, W1.4.

  **References**:
  - External: `https://huggingface.co/docs/huggingface_hub/main/en/package_reference/file_download#huggingface_hub.snapshot_download` — official resume support
  - External: `https://huggingface.co/docs/huggingface_hub/guides/manage-cache` — cache layout & verification patterns
  - External: `https://github.com/lundberg/respx` — HTTP mocking for tests
  - File: `docs/heartlib-api-surface.md` (P0.4) — confirms 3 required repos and approximate sizes
  - WHY: Metis flagged "no partial download resume" + "no SHA verification" as TWO blocking gaps. Models are 3-10 GB each; users on flaky connections will hit partial states constantly. SHA verification catches HF mirror corruption (rare but catastrophic).

  **Acceptance Criteria**:
  - [ ] All 5 RED tests green
  - [ ] SSE stream emits ≥1 progress event per second during download
  - [ ] Resume verified: kill mid-download, restart, byte counter continues from saved offset (not 0)
  - [ ] SHA mismatch causes verify() to return false with offending file paths
  - [ ] HF_TOKEN never appears in logs, response bodies, or temp files

  **QA Scenarios**:
  ```
  Scenario: Real download of smallest required model (HeartCodec ~500MB)
    Tool: Bash
    Preconditions: sidecar running, ~5GB free disk, internet
    Steps:
      1. JOB=$(curl -sH "X-Audiomorph-Token: $T" -X POST http://127.0.0.1:$P/models/HeartMuLa%2FHeartCodec-oss-20260123/download | jq -r .job_id)
      2. timeout 600 curl -sH "X-Audiomorph-Token: $T" -N http://127.0.0.1:$P/models/jobs/$JOB/events | tee /tmp/download-events.txt | head -50
      3. curl -sH "X-Audiomorph-Token: $T" -X POST http://127.0.0.1:$P/models/HeartMuLa%2FHeartCodec-oss-20260123/verify | jq -e '.valid==true'
    Expected: Progress events stream; verify returns valid=true
    Failure Indicators: No events for 10s; verify returns false; download exceeds disk space limit
    Evidence: .sisyphus/evidence/task-W2.2-real-download.txt

  Scenario: Resume after interruption
    Tool: Bash
    Steps:
      1. Start download; after 5s, kill sidecar (simulates crash)
      2. Restart sidecar; check GET /models/{id} returns state=partial with bytes_done > 0
      3. POST /models/{id}/download again; observe events stream — bytes_done starts near previous value, not 0
    Expected: bytes_done at resume ≥ 80% of pre-kill value
    Evidence: .sisyphus/evidence/task-W2.2-resume.txt

  Scenario: SHA mismatch detection (negative)
    Tool: Bash
    Steps:
      1. After verified download, corrupt 1 byte: echo "X" >> $MODELS_DIR/HeartCodec/config.json
      2. curl POST /models/.../verify
      3. jq -e '.valid==false and (.mismatches | length > 0)'
    Expected: valid=false; config.json in mismatches
    Evidence: .sisyphus/evidence/task-W2.2-sha-mismatch.txt

  Scenario: HF token never leaks (security)
    Tool: Bash
    Steps:
      1. Spawn sidecar with HF_TOKEN=hf_secrettoken12345
      2. Run small download
      3. ! grep -F "hf_secrettoken12345" /tmp/sidecar.log /tmp/download-events.txt
    Expected: Token not present in any output
    Evidence: .sisyphus/evidence/task-W2.2-token-leak.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-W2.2-real-download.txt`
  - [ ] `.sisyphus/evidence/task-W2.2-resume.txt`
  - [ ] `.sisyphus/evidence/task-W2.2-sha-mismatch.txt`
  - [ ] `.sisyphus/evidence/task-W2.2-token-leak.txt`

  **Commit**: YES
  - Message: `feat(models): HF download manager with resume + SHA + cancel + BYOK`
  - Files: `apps/sidecar/src/audiomorph/models/**`, `apps/sidecar/src/audiomorph/routers/models.py`, `apps/sidecar/tests/test_models_*.py`
  - Pre-commit: `cd apps/sidecar && uv run pytest tests/test_models_*.py`

- [x] W2.3. **[HIGH-RISK]** Generation endpoint: heartlib invocation, cancel, OOM recovery, SSE progress

  **What to do**:
  - Implement `apps/sidecar/src/audiomorph/generation/engine.py`:
    - `GenerationEngine` class with lazy-loaded heartlib modules (import on first call, cache loaded model in process memory)
    - `async generate(req: GenerationRequest, job_id: str, progress_cb) -> GenerationResult`:
      - Validate: duration ≤ 240s, prompt ≤ 2000 chars, lyrics ≤ 4000 chars, seed in i32 range
      - Resolve model dir via W2.2 manager (raise MODEL_NOT_FOUND if missing/unverified)
      - Detect device per W2.1 healthz; raise GPU_UNAVAILABLE if user disabled CPU fallback in settings
      - Wrap heartlib call in `torch.inference_mode()` + `try/except torch.cuda.OutOfMemoryError` → free cache, retry once at half-batch; second OOM → raise `ApiError(OUT_OF_MEMORY, hint="Try shorter duration or close other GPU apps")`
      - Stream progress via `progress_cb({step, total_steps, eta_s, phase})` — phases: loading|generating|encoding|finalizing
      - Output `<jobs_dir>/<job_id>/audio.wav` (44.1kHz/16-bit), return `GenerationResult{job_id, file_path, duration_seconds, model_id, seed, prompt, lyrics, created_at}`
    - Cancel: register `asyncio.Event` per job_id; check in progress_cb every step; on set, raise `CancelledError` → cleanup partial files, raise `ApiError(CANCELLED)`
    - Concurrency: max 1 generation in flight globally (queue or reject with 429 — choose reject per Metis recommendation)
  - Endpoints in `routers/jobs.py`:
    - `POST /jobs/generate` → body=GenerationRequest, returns `{job_id}` immediately, generation runs in background
    - `GET /jobs/{job_id}` → returns JobStatus + GenerationResult when complete
    - `GET /jobs/{job_id}/events` → SSE stream of progress + final event
    - `DELETE /jobs/{job_id}` → cancel
  - Tests (RED first):
    - Happy path: small duration, mocked heartlib, assert file written + result returned
    - Validation: duration=999 → 422 + VALIDATION_ERROR
    - Cancel: start, cancel after 200ms, assert CANCELLED within 5s + partial file removed
    - OOM: monkeypatch heartlib to raise OutOfMemoryError twice, assert OUT_OF_MEMORY response
    - Concurrent reject: start job, start second, assert 429
    - MODEL_NOT_FOUND: request model not verified, assert envelope

  **Must NOT do**:
  - Do NOT load model on every request (single cached instance, refcount-based eviction)
  - Do NOT swallow `CancelledError` — must propagate
  - Do NOT write final audio to a path outside `<jobs_dir>/<job_id>/`
  - Do NOT block the event loop with sync heartlib calls — run in `asyncio.to_thread()` or dedicated ThreadPoolExecutor
  - Do NOT allow >1 concurrent generation (will OOM on consumer GPUs)
  - Do NOT log the prompt at INFO level (PII risk — DEBUG only)

  **Recommended Agent Profile**:
  - **Category**: `deep` — Async + GPU + cancel + OOM recovery + streaming all converge
  - **Skills**: `[]`

  **Parallelization**: YES with W2.4-W2.8. Wave 2. Blocks W3.4 (gen form UI), W3.6 (playback). Blocked by W2.1, W2.2, P0.4.

  **References**:
  - File: `docs/heartlib-api-surface.md` (P0.4) — call signatures, supported devices, known OOM thresholds
  - File: `heartlib/examples/run_music_generation.py` — canonical invocation pattern
  - External: `https://pytorch.org/docs/stable/notes/cuda.html#memory-management` — cache freeing on OOM
  - External: `https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse` — SSE pattern
  - WHY: Metis flagged "no cancel" + "no OOM recovery" + "no concurrency cap" as three blocking gaps. Generation is THE core feature; bad UX here (hung jobs, crashes, no progress) tanks the product.

  **Acceptance Criteria**:
  - [ ] All 6 RED tests green
  - [ ] SSE stream emits progress ≥1/sec during generation
  - [ ] Cancel acknowledged within 5s with partial files cleaned
  - [ ] OOM produces user-actionable error (not raw torch exception)
  - [ ] Generated file is valid WAV (ffprobe confirms format)

  **QA Scenarios**:
  ```
  Scenario: End-to-end short generation (real heartlib, mocked-or-real model)
    Tool: Bash
    Preconditions: sidecar running, model verified, GPU available OR CPU fallback enabled
    Steps:
      1. JOB=$(curl -sH "X-Audiomorph-Token: $T" -X POST http://127.0.0.1:$P/jobs/generate -d '{"prompt":"upbeat piano","lyrics":"","duration_seconds":10,"seed":42,"model_id":"HeartMuLa/HeartMuLaGen"}' -H "Content-Type: application/json" | jq -r .job_id)
      2. timeout 300 curl -sH "X-Audiomorph-Token: $T" -N http://127.0.0.1:$P/jobs/$JOB/events | tee /tmp/gen-events.txt
      3. RESULT=$(curl -sH "X-Audiomorph-Token: $T" http://127.0.0.1:$P/jobs/$JOB)
      4. FILE=$(echo $RESULT | jq -r .file_path)
      5. ffprobe -v error -show_format -show_streams "$FILE" | grep -E "codec_name=pcm|sample_rate=44100"
    Expected: WAV file at 44.1kHz; events stream contains loading→generating→encoding→finalizing
    Failure Indicators: No events; file missing; file not valid WAV; stuck in single phase >120s
    Evidence: .sisyphus/evidence/task-W2.3-e2e-gen.txt

  Scenario: Cancel acknowledged quickly
    Tool: Bash
    Steps:
      1. Start 60s generation
      2. Sleep 3
      3. curl -X DELETE; record timestamp
      4. Poll GET /jobs/{id} until status=cancelled; record timestamp
      5. Assert elapsed ≤ 5s
      6. Assert no leftover files under <jobs_dir>/<job_id>/ except metadata.json
    Expected: Cancelled within 5s; partial WAV removed
    Evidence: .sisyphus/evidence/task-W2.3-cancel.txt

  Scenario: OOM produces actionable error
    Tool: Bash
    Steps:
      1. Patch GenerationEngine to force OOM (env AUDIOMORPH_FORCE_OOM=1)
      2. POST /jobs/generate
      3. Wait for final event
      4. jq -e '.code=="OUT_OF_MEMORY" and (.hint | length > 0)'
    Expected: Envelope with OUT_OF_MEMORY + hint
    Evidence: .sisyphus/evidence/task-W2.3-oom.txt

  Scenario: Concurrent generation rejected
    Tool: Bash
    Steps:
      1. Start job A
      2. Immediately start job B
      3. Assert B returns HTTP 429 with code=VALIDATION_ERROR or new CONCURRENCY_LIMIT
    Expected: 429
    Evidence: .sisyphus/evidence/task-W2.3-concurrency-reject.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-W2.3-e2e-gen.txt`
  - [ ] `.sisyphus/evidence/task-W2.3-cancel.txt`
  - [ ] `.sisyphus/evidence/task-W2.3-oom.txt`
  - [ ] `.sisyphus/evidence/task-W2.3-concurrency-reject.txt`

  **Commit**: YES
  - Message: `feat(generation): heartlib-backed generate endpoint with cancel + OOM recovery + SSE`
  - Files: `apps/sidecar/src/audiomorph/generation/**`, `apps/sidecar/src/audiomorph/routers/jobs.py`, `apps/sidecar/tests/test_generation_*.py`
  - Pre-commit: `cd apps/sidecar && uv run pytest tests/test_generation_*.py`

- [x] W2.4. Lyrics transcription endpoint (heartlib-backed)

  **What to do**: Implement `routers/lyrics.py` POST `/lyrics/transcribe` with body `{audio_path | audio_base64}` → returns `LyricsResult{text, timings: [{start_s, end_s, line}], language?}`. Use heartlib lyrics pipeline (per `heartlib/examples/run_lyrics_transcription.py`). Same concurrency cap (1) + cancel support pattern as W2.3. Validate file size ≤ 50MB, duration ≤ 10min. Stream progress via SSE at `/lyrics/jobs/{id}/events`. RED tests for: happy path with sample WAV, invalid format → VALIDATION_ERROR, oversize → VALIDATION_ERROR, cancel mid-transcription.

  **Must NOT do**: Do NOT mix lyrics transcription with music generation queue (separate single-slot queue). Do NOT persist user audio outside `<jobs_dir>/<job_id>/`.

  **Recommended Agent Profile**: `unspecified-high`, skills `[]`

  **Parallelization**: YES. Wave 2. Blocks W3.8 (lyrics UI). Blocked by W2.1, P0.4.

  **References**: `heartlib/examples/run_lyrics_transcription.py`, `docs/heartlib-api-surface.md`. WHY: User requested lyrics transcription as MVP feature; mirrors generation patterns to amortize concurrency/cancel infrastructure.

  **Acceptance Criteria**: All RED tests green; valid sample WAV produces non-empty `text` and ≥1 timing entry.

  **QA Scenarios**:
  ```
  Scenario: Sample audio transcribed
    Tool: Bash
    Preconditions: heartlib lyrics model verified, sample WAV at fixtures/sample-lyrics.wav (~30s vocal)
    Steps:
      1. curl -sH "X-Audiomorph-Token: $T" -X POST http://127.0.0.1:$P/lyrics/transcribe -F "audio=@fixtures/sample-lyrics.wav"
      2. jq -e '.text | length > 0' && jq -e '.timings | length > 0'
    Expected: Non-empty text + ≥1 timing
    Evidence: .sisyphus/evidence/task-W2.4-transcribe.txt
  ```

  **Commit**: YES. `feat(lyrics): transcription endpoint via heartlib`. Files: `apps/sidecar/src/audiomorph/lyrics/**`, `routers/lyrics.py`, tests. Pre-commit: `uv run pytest tests/test_lyrics_*.py`.

- [x] W2.5. SQLite persistence layer (SQLModel) — jobs, generations, settings tables

  **What to do**: Define `apps/sidecar/src/audiomorph/db/models.py` with SQLModel tables: `Generation(id, job_id, model_id, prompt, lyrics, seed, duration_s, file_path, created_at, status)`, `Job(id, kind, status, created_at, updated_at, error_code?, error_message?)`, `Setting(key, value_json)`. Open SQLite at `<app_data>/audiomorph.db` with WAL mode + busy_timeout=5000. Implement Alembic migrations or SQLModel `create_all()` with version table. Provide `db/repo.py` with CRUD helpers: `record_generation()`, `list_generations(limit, offset)`, `get_setting(key, default)`, `set_setting(key, value)`. RED tests: insert + list + WAL concurrent read while write. Wire `init_db()` into sidecar startup.

  **Must NOT do**: No raw SQL strings in routers (repo layer only). No storing API keys or secrets in any table. No `PRAGMA journal_mode=DELETE`.

  **Recommended Agent Profile**: `unspecified-high`, skills `[]`

  **Parallelization**: YES. Wave 2. Blocks W2.3 (record completed gen), W2.6 (history), W2.8 (settings). Blocked by W2.1, W1.2.

  **References**: External `https://sqlmodel.tiangolo.com/`, `https://www.sqlite.org/wal.html`. WHY: Single source of truth for job history + user settings; WAL needed because SSE reads + job writes happen concurrently.

  **Acceptance Criteria**: All RED tests green; db file created on startup; WAL mode confirmed via `PRAGMA journal_mode`.

  **QA Scenarios**:
  ```
  Scenario: WAL mode + concurrent read/write
    Tool: Bash
    Steps:
      1. Spawn sidecar; sqlite3 $APP_DATA/audiomorph.db "PRAGMA journal_mode" → expect "wal"
      2. Insert 100 generations via repo + simultaneously list via second connection
      3. Assert no SQLITE_BUSY errors
    Evidence: .sisyphus/evidence/task-W2.5-wal.txt
  ```

  **Commit**: YES. `feat(db): SQLModel persistence with WAL mode`. Files: `apps/sidecar/src/audiomorph/db/**`, tests. Pre-commit: `uv run pytest tests/test_db_*.py`.

- [x] W2.6. Export endpoint: ffmpeg-backed format conversion (WAV/MP3/FLAC)

  **What to do**: Implement `routers/export.py` POST `/export` with body `{generation_id, format: wav|mp3|flac, bitrate_kbps?}` → returns `{file_path, format, size_bytes}`. Use bundled ffmpeg 8 (from W1.6) via subprocess; build cmd safely with `shlex` (never shell=True). Output to `<jobs_dir>/<gen_id>/export.<ext>`. Validate: format in allow-list; bitrate 64-320 for mp3 only. Capture ffmpeg stderr; on non-zero exit raise `ApiError(EXPORT_FAILED, hint=<first line of stderr>)`. Timeout 5min via `asyncio.wait_for`. RED tests: WAV→MP3 conversion, invalid format → VALIDATION_ERROR, ffmpeg missing → EXPORT_FAILED with actionable hint.

  **Must NOT do**: No `shell=True` ever. Do NOT trust user-supplied file paths — only resolve via generation_id lookup. Do NOT keep ffmpeg subprocess running after request.

  **Recommended Agent Profile**: `unspecified-high`, skills `[]`

  **Parallelization**: YES. Wave 2. Blocks W3.7 (export UI). Blocked by W2.1, W2.5, W1.6 (ffmpeg bundling).

  **References**: `https://ffmpeg.org/ffmpeg.html`, `https://docs.python.org/3/library/asyncio-subprocess.html`. WHY: Metis flagged "ffmpeg failure path unclear" as high gap — explicit error envelope mapping required.

  **Acceptance Criteria**: All RED tests green; WAV→MP3 produces valid MP3 (ffprobe confirms); ffmpeg stderr surfaced in error hint.

  **QA Scenarios**:
  ```
  Scenario: WAV to MP3 320kbps
    Tool: Bash
    Steps:
      1. Seed a generation row + put sample.wav at recorded file_path
      2. curl -sH "X-Audiomorph-Token: $T" -X POST http://127.0.0.1:$P/export -d '{"generation_id":"g1","format":"mp3","bitrate_kbps":320}' -H "Content-Type: application/json"
      3. ffprobe -v error -show_streams "$EXPORTED" | grep "codec_name=mp3"
      4. ffprobe shows bit_rate ≈ 320000
    Evidence: .sisyphus/evidence/task-W2.6-export-mp3.txt
  ```

  **Commit**: YES. `feat(export): ffmpeg-backed format conversion`. Files: `routers/export.py`, `services/ffmpeg.py`, tests. Pre-commit: `uv run pytest tests/test_export_*.py`.

- [x] W2.7. OpenRouter proxy router (BYOK relay, no key persistence)

  **What to do**: Implement `routers/openrouter.py` POST `/openrouter/chat` with body `{messages, model?, temperature?, max_tokens?}`. Read user's OpenRouter API key from per-request header `X-OpenRouter-Key` (passed by Electron from safeStorage/keytar per W4.5 — never stored sidecar-side). Forward to `https://openrouter.ai/api/v1/chat/completions` via `httpx.AsyncClient` with 60s timeout + 2 retries on 5xx. Stream response back as SSE if client requested `stream=true`. Validate: messages non-empty, key present. Surface OpenRouter errors as `ApiError(EXTERNAL_API_ERROR, hint=<openrouter message>)`. RED tests with `respx` mocking: happy path, missing key → 401-ish envelope, 5xx retry, stream pass-through.

  **Must NOT do**: NEVER log the OpenRouter key. NEVER persist it (no SQLite, no temp files, no env). NEVER cache responses. Do NOT add own system prompts — pure relay.

  **Recommended Agent Profile**: `unspecified-high`, skills `[]`

  **Parallelization**: YES. Wave 2. Blocks W3.5 (prompt-assist UI). Blocked by W2.1.

  **References**: `https://openrouter.ai/docs/api-reference/chat-completions`, `https://www.python-httpx.org/async/`. WHY: User specified BYOK + safeStorage; sidecar must be a transparent relay so the key path stays Electron→header→outbound only.

  **Acceptance Criteria**: All RED tests green; key never appears in logs (grep test); streaming pass-through verified.

  **QA Scenarios**:
  ```
  Scenario: Key never leaks (security)
    Tool: Bash
    Steps:
      1. curl -sH "X-Audiomorph-Token: $T" -H "X-OpenRouter-Key: sk-or-secret-marker-12345" -X POST http://127.0.0.1:$P/openrouter/chat -d '{"messages":[{"role":"user","content":"hi"}]}' -H "Content-Type: application/json" || true
      2. ! grep -F "sk-or-secret-marker-12345" /tmp/sidecar.log
    Expected: Marker absent from logs
    Evidence: .sisyphus/evidence/task-W2.7-key-leak.txt
  ```

  **Commit**: YES. `feat(openrouter): BYOK relay proxy`. Files: `routers/openrouter.py`, tests. Pre-commit: `uv run pytest tests/test_openrouter_*.py`.

- [x] W2.8. Settings endpoints + first-run state machine

  **What to do**: Implement `routers/settings.py` with `GET /settings`, `PUT /settings/{key}` (value in body). Persist via W2.5 repo. Define typed schema for keys: `models_dir` (path), `cpu_fallback_enabled` (bool), `theme` (light|dark|system), `default_model_id` (str), `hf_token_present` (bool — reflective only, real token stays in keytar), `openrouter_key_present` (bool — reflective), `first_run_completed` (bool). Validate values via Pydantic per-key. Add `GET /first-run/status` → `{completed, missing_steps: [pick_models_dir|download_models|...]}`. RED tests: unknown key → VALIDATION_ERROR, type mismatch → VALIDATION_ERROR, first-run progression.

  **Must NOT do**: Do NOT accept arbitrary keys. Do NOT store secrets (the `*_present` booleans are flags, not values). Do NOT allow models_dir to point outside user home without explicit override.

  **Recommended Agent Profile**: `quick`, skills `[]`

  **Parallelization**: YES. Wave 2. Blocks W3.2 (first-run wizard), W3.9 (settings UI). Blocked by W2.1, W2.5.

  **References**: `https://docs.pydantic.dev/latest/concepts/validators/`. WHY: Round 3 user decision "User picks at first-run" requires explicit wizard state tracking.

  **Acceptance Criteria**: All RED tests green; first-run status transitions correctly as settings populate.

  **QA Scenarios**:
  ```
  Scenario: First-run state transitions
    Tool: Bash
    Steps:
      1. Fresh db; GET /first-run/status → completed=false, missing_steps includes "pick_models_dir"
      2. PUT /settings/models_dir = "/tmp/m"
      3. GET /first-run/status → missing_steps no longer includes "pick_models_dir"
      4. Complete all steps; GET → completed=true
    Evidence: .sisyphus/evidence/task-W2.8-first-run.txt
  ```

  **Commit**: YES. `feat(settings): typed settings + first-run state`. Files: `routers/settings.py`, `services/first_run.py`, tests. Pre-commit: `uv run pytest tests/test_settings_*.py`.

- [x] W3.1. Next.js 15 app scaffold (static export) + Tailwind + shadcn/ui + Magic UI + Geist + OKLCH tokens

  **What to do**: Initialize `apps/renderer/` as Next.js 15 (App Router, TypeScript strict, `output: 'export'`, `images.unoptimized: true`, `trailingSlash: true`, `basePath: ''`, `assetPrefix: './'`). Install Tailwind v4 with `@theme inline` block defining OKLCH color tokens (primary, surface, surface-2, surface-3, accent, success, warning, danger, text, text-muted, border). Wire Geist Sans + Geist Mono via `next/font/local` (bundled, no Google fetch). Install shadcn/ui CLI + add base components: button, dialog, input, label, select, slider, progress, tabs, toast, card, badge, separator, scroll-area, tooltip. Install Magic UI components: shimmer-button, animated-beam, marquee, number-ticker, magic-card (copy source per their installation pattern — vendored). Create `lib/design-tokens.ts` exporting CSS var names. Set up Zustand store skeleton at `lib/stores/` with `useAppStore`, `useGenerationStore`, `useSettingsStore`. Provide `.env.example` documenting `NEXT_PUBLIC_API_BASE_URL` (overridden at runtime by Electron preload injection per W4.4). Write RED Playwright test: app boots, dark-mode default, primary OKLCH token resolves to expected hex range, locale `en-US` + `de-DE` + `ja-JP` render without layout breaks, HiDPI screenshot at 2x DPR captures.

  **Must NOT do**: No `next/image` external loaders. No Google Fonts (offline-first). No client-side fetches to non-localhost in scaffold. No CSS-in-JS runtime (Tailwind only). No `'use client'` on root layout. Do NOT hardcode `http://127.0.0.1:PORT` — must read from injected window global.

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES with W3.2-W3.9. Wave 3 entry task. Blocks ALL W3.x UI work. Blocked by P0.1 (mono setup).

  **References**: External `https://nextjs.org/docs/app/guides/static-exports`, `https://ui.shadcn.com/docs/installation/next`, `https://magicui.design/docs/installation`, `https://tailwindcss.com/docs/v4-beta`, `https://vercel.com/font`. WHY: User specified "best looking" UI + Tailwind + Next.js + PWA-style static; Metis flagged locale/HiDPI as high-priority gaps; Electron loads via `file://` which requires `assetPrefix: './'` + `trailingSlash: true` for asset resolution to work.

  **Acceptance Criteria**: `bun run build` produces `apps/renderer/out/` with valid index.html; Playwright RED tests green; lighthouse-style sanity (no console errors on cold boot).

  **QA Scenarios**:
  ```
  Scenario: Static export boots in file:// mode
    Tool: interactive_bash (tmux) + Playwright
    Steps:
      1. cd apps/renderer && bun run build
      2. Open out/index.html in Playwright via `file://` URL
      3. Assert no console errors; assert body[data-theme="dark"] present
      4. Screenshot at viewport 1440x900 @ 2x DPR
      5. Reload with `lang="de-DE"` html attr; assert no overflow on nav
    Expected: Boots cleanly; dark default; HiDPI screenshot crisp; locales render
    Evidence: .sisyphus/evidence/task-W3.1-boot.png, task-W3.1-de-locale.png, task-W3.1-ja-locale.png

  Scenario: OKLCH primary token resolves
    Tool: Playwright
    Steps:
      1. Evaluate `getComputedStyle(document.documentElement).getPropertyValue('--color-primary')`
      2. Assert value matches oklch() pattern AND parses to hex in expected accent range
    Evidence: .sisyphus/evidence/task-W3.1-tokens.txt
  ```

  **Commit**: YES. `feat(renderer): Next.js 15 static export + Tailwind + shadcn/ui + Magic UI + Geist + OKLCH tokens`. Files: `apps/renderer/**`. Pre-commit: `cd apps/renderer && bun run build && bun test`.

- [x] W3.2. First-run wizard UI: 4-step (welcome → pick models dir → download models → ready)

  **What to do**: Build `apps/renderer/app/first-run/page.tsx` with shadcn `<Dialog>` (non-dismissible, full-screen) + step indicator. Steps: (1) Welcome — branding + brief explainer + "Get started" button; (2) Pick models dir — native dir picker via Electron IPC `dialog:openDirectory` (preload-exposed per W4.4), shows free space + required ~10 GB warning; (3) Download models — list 3 required models from `GET /models`, per-row `<Progress>` bound to SSE from W2.2 (`/models/jobs/{id}/events`), retry button on error, total ETA, cancel-all button; (4) Ready — confirmation + "Open Studio" CTA. Wire to `GET /first-run/status` (W2.8) — if `completed=true`, redirect to `/`. Optimistic store updates with rollback on API failure. Toasts via shadcn/sonner on error. Keyboard nav (Tab/Enter/Esc-disabled on step 3 during active download). RED Playwright tests: step progression, error retry, cancel mid-download, locale rendering (en/de/ja), screen-reader landmarks present.

  **Must NOT do**: Do NOT allow skipping required steps. Do NOT proceed if free disk < 12 GB. Do NOT call download endpoints in parallel (queue per W2.2). Do NOT use `window.confirm` (must use shadcn dialog).

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES with W3.3-W3.9. Wave 3. Blocks W4.1 (renderer-shell integration smoke). Blocked by W3.1, W2.8, W2.2, W4.4 (preload bridge — soft dep, can mock in tests).

  **References**: External `https://ui.shadcn.com/docs/components/dialog`, `https://ui.shadcn.com/docs/components/progress`, `https://www.electronjs.org/docs/latest/api/dialog#dialogshowopendialogbrowserwindow-options`. File: `apps/sidecar/src/audiomorph/routers/settings.py` (W2.8 first-run state). WHY: Round 3 user decision "User picks at first-run" requires guided wizard; UX failure here blocks entire app.

  **Acceptance Criteria**: All RED Playwright tests green; wizard cannot be bypassed if `first_run_completed=false`; SSE progress reflected within 1s of backend event.

  **QA Scenarios**:
  ```
  Scenario: Happy-path wizard completion with mocked backend
    Tool: Playwright
    Steps:
      1. Stub `GET /first-run/status` → completed:false, missing:[pick_models_dir,download_models]
      2. Stub `dialog:openDirectory` → "/tmp/m"
      3. Stub `/models` + SSE → emit progress 0→100 in 2s per model
      4. Click through steps; assert URL transitions to "/" at end
      5. Screenshot each step
    Evidence: .sisyphus/evidence/task-W3.2-wizard-step{1..4}.png

  Scenario: Disk-space refusal
    Tool: Playwright
    Steps:
      1. Stub dir picker to return path with simulated 5 GB free (via injected hook)
      2. Assert step 2 shows blocking error + "Next" disabled
    Evidence: .sisyphus/evidence/task-W3.2-low-disk.png

  Scenario: Download error retry
    Tool: Playwright
    Steps:
      1. Stub SSE to emit error event mid-download
      2. Assert per-row error UI + Retry button
      3. Click Retry; stub success; assert progression resumes
    Evidence: .sisyphus/evidence/task-W3.2-retry.png
  ```

  **Commit**: YES. `feat(renderer): first-run wizard with model download UI`. Files: `apps/renderer/app/first-run/**`, `apps/renderer/lib/stores/first-run.ts`, tests. Pre-commit: `bun test apps/renderer/tests/first-run.*`.

- [x] W3.3. Model library page — list, download, verify, delete with live SSE

  **What to do**: Build `apps/renderer/app/models/page.tsx`. Fetch `GET /models` on mount; render shadcn `<Card>` per model with: name, repo id, size, state badge (missing|downloading|verified|partial|corrupted), per-model action buttons (Download / Verify / Delete / Cancel). On Download click → POST `/models/{id}/download`, subscribe to SSE `/models/jobs/{job_id}/events`, animate progress with Magic UI `<NumberTicker>` + shadcn `<Progress>` showing bytes_done/total + speed_mbps + current_file. Wire delete confirmation via shadcn `<AlertDialog>`. Zustand slice `useModelsStore` holds map of jobId→progress. Disable Download globally when any model is downloading (W2.2 single-job lock). RED Playwright tests: list renders, download progress reflects SSE within 1s, verify-mismatch shows error UI, delete confirms before destructive action.

  **Must NOT do**: No parallel downloads of same model. No optimistic deletion (wait for 204). No exposing repo internal paths to user. No silent failure — every error renders toast.

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES. Wave 3. Blocked by W3.1, W2.2.

  **References**: `apps/sidecar/src/audiomorph/routers/models.py` (W2.2 endpoints), `https://ui.shadcn.com/docs/components/alert-dialog`, `https://magicui.design/docs/components/number-ticker`. WHY: Models are large + slow; live progress + actionable error UI is required for trust.

  **Acceptance Criteria**: All RED tests green; SSE events reflected in <1s; delete requires confirmation.

  **QA Scenarios**:
  ```
  Scenario: Live download progress
    Tool: Playwright
    Steps:
      1. Stub SSE to emit 10 progress events over 2s ending at 100%
      2. Click Download; assert progress bar fills + bytes_done ticker animates
      3. Assert state badge transitions missing → downloading → verified
    Evidence: .sisyphus/evidence/task-W3.3-download.png

  Scenario: Verify mismatch surfaces error
    Tool: Playwright
    Steps:
      1. Stub /verify → {valid:false, mismatches:[config.json]}
      2. Click Verify; assert error toast + state badge = corrupted
    Evidence: .sisyphus/evidence/task-W3.3-mismatch.png
  ```

  **Commit**: YES. `feat(renderer): model library page with live progress`. Files: `apps/renderer/app/models/**`, `lib/stores/models.ts`, tests. Pre-commit: `bun test apps/renderer/tests/models.*`.

- [x] W3.4. Generation form — prompt, lyrics, model, duration, seed, advanced panel

  **What to do**: Build `apps/renderer/app/page.tsx` (root = generation studio). Form fields via shadcn: `<Textarea>` for prompt (max 2000, char counter), `<Textarea>` for lyrics (max 4000, optional, with "Insert from Lyrics Workspace" link to W3.8), `<Select>` for model (only verified models from W2.2 `GET /models`), `<Slider>` for duration (1-240s, default 30), `<Input type="number">` for seed (placeholder "random" with dice button), `<Collapsible>` "Advanced" panel for temperature/top_p (defer if heartlib doesn't expose). Submit → POST `/jobs/generate`; on success store `job_id` in `useGenerationStore`, subscribe to SSE `/jobs/{id}/events`, transition UI to "Generating" state with phase indicator (loading→generating→encoding→finalizing) using shadcn `<Tabs>` styled as steps + Magic UI `<AnimatedBeam>`. Big shadcn-shimmer Cancel button while running. On terminal event → render result card (passes generation_id to W3.6 player). Block submit if no verified model OR if generation in flight. RED Playwright tests: validation (over-length prompt → inline error), happy submit flow, cancel mid-gen, no-models empty state, OOM error toast.

  **Must NOT do**: No localStorage of API responses (Zustand only, ephemeral). No auto-resubmit on error. Do NOT enable submit while another job runs (server returns 429 — surface as toast). No hardcoded model list (always from API).

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES. Wave 3. Blocked by W3.1, W2.3.

  **References**: `apps/sidecar/src/audiomorph/routers/jobs.py` (W2.3). `https://ui.shadcn.com/docs/components/slider`, `https://magicui.design/docs/components/animated-beam`. WHY: Core entry point; must surface phase + cancel reliably given long-running gen.

  **Acceptance Criteria**: All RED tests green; cancel acknowledged in UI within 5s of click; OOM hint visible in error UI.

  **QA Scenarios**:
  ```
  Scenario: Submit + phase transitions
    Tool: Playwright
    Steps:
      1. Stub POST /jobs/generate → {job_id:"j1"}
      2. Stub SSE → phase=loading, generating(step 5/10), encoding, finalizing, done
      3. Assert step indicator advances; final result card renders
    Evidence: .sisyphus/evidence/task-W3.4-submit-flow.png

  Scenario: Cancel UI feedback
    Tool: Playwright
    Steps:
      1. Submit; SSE emits generating(step 3/10)
      2. Click Cancel; stub DELETE returns 204; SSE emits cancelled
      3. Assert "Cancelled" badge within 5s
    Evidence: .sisyphus/evidence/task-W3.4-cancel.png
  ```

  **Commit**: YES. `feat(renderer): generation form + live phase UI`. Files: `apps/renderer/app/page.tsx`, `components/generation/**`, `lib/stores/generation.ts`, tests. Pre-commit: `bun test apps/renderer/tests/generation.*`.

- [x] W3.5. Prompt-assist drawer — OpenRouter chat with BYOK key prompt

  **What to do**: Build `apps/renderer/components/prompt-assist/Drawer.tsx` using shadcn `<Sheet>` (slide-in from right, triggered from W3.4 form via "Improve with AI" button). Streaming chat: user sends free-form intent → assistant returns enhanced prompt + suggested lyrics. POST `/openrouter/chat` (W2.7) with `stream=true`, parse SSE chunks, render as typewriter via Magic UI. Model dropdown (default `anthropic/claude-3.5-sonnet`, allow override). "Use this prompt" / "Use these lyrics" action buttons inject text back into W3.4 form via Zustand. If `openrouter_key_present=false` (W2.8 setting), show inline `<AlertDialog>` linking to W3.9 settings to set key. Pass key via `X-OpenRouter-Key` header — preload reads from keytar (W4.5). RED Playwright tests: streaming render, missing-key flow, inject-prompt updates form.

  **Must NOT do**: NEVER render or log the OpenRouter key in UI. NEVER persist chat history to disk (in-memory Zustand only). No auto-send on every keystroke (explicit submit only).

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES. Wave 3. Blocked by W3.1, W3.4, W2.7.

  **References**: `apps/sidecar/src/audiomorph/routers/openrouter.py` (W2.7), `https://ui.shadcn.com/docs/components/sheet`. WHY: Differentiator UX; lowers barrier to good prompts.

  **Acceptance Criteria**: All RED tests green; streaming visible within 500ms of first chunk; key never visible in DOM.

  **QA Scenarios**:
  ```
  Scenario: Streaming completion + inject
    Tool: Playwright
    Steps:
      1. Stub SSE to emit 5 chunks
      2. Open drawer; type intent; submit
      3. Assert typewriter renders progressively
      4. Click "Use this prompt"; assert form textarea populated
    Evidence: .sisyphus/evidence/task-W3.5-stream.png

  Scenario: Missing key prompts settings
    Tool: Playwright
    Steps:
      1. Stub /settings → openrouter_key_present:false
      2. Click "Improve with AI"; assert dialog with link to /settings
    Evidence: .sisyphus/evidence/task-W3.5-no-key.png
  ```

  **Commit**: YES. `feat(renderer): prompt-assist drawer with OpenRouter streaming`. Files: `apps/renderer/components/prompt-assist/**`, tests. Pre-commit: `bun test apps/renderer/tests/prompt-assist.*`.

- [x] W3.6. Audio playback + waveform/spectrum (wavesurfer.js v7, lazy-loaded)

  **What to do**: Build `apps/renderer/components/player/AudioPlayer.tsx` with wavesurfer.js v7 (dynamic import via `next/dynamic` with `{ssr:false}` — avoids static-export crash). Props: `{generationId, fileUrl}` (fileUrl resolved via `file://` from Electron `getFilePath` IPC per W4.4 OR via `GET /jobs/{id}/file` streaming endpoint — pick file:// for perf). Render: waveform on top, spectrum (wavesurfer spectrogram plugin) on bottom, transport controls (play/pause/stop/seek), time display (current/total), zoom slider. Theme wavesurfer colors from OKLCH tokens (W3.1). Handle missing file → graceful empty state. Lazy-load on mount only when generation is `done`. RED Playwright tests: loads waveform from local fixture WAV, play/pause toggles, seek updates currentTime, zoom changes pixels-per-second.

  **Must NOT do**: No CDN load of wavesurfer (bundled only). No autoplay on mount. Do NOT fetch via `http://` if file is local (use file://). No memory leak — destroy wavesurfer instance on unmount.

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES. Wave 3. Blocked by W3.1, W3.4 (for integration), W2.3 (file path source).

  **References**: External `https://wavesurfer.xyz/docs/`, `https://wavesurfer.xyz/examples/?spectrogram.js`. WHY: User specified "waveform + spectrum"; lazy + ssr:false required for static export.

  **Acceptance Criteria**: All RED tests green; waveform renders within 2s of fixture load; no leak after 10 mount/unmount cycles (Chrome DevTools memory snapshot in test).

  **QA Scenarios**:
  ```
  Scenario: Playback + seek + zoom
    Tool: Playwright
    Steps:
      1. Mount player with fixtures/sample.wav (5s tone)
      2. Wait for waveform draw; click play; assert currentTime > 0 after 500ms
      3. Click waveform at 50%; assert currentTime ≈ 2.5s
      4. Drag zoom slider; assert pixels-per-second changed
    Evidence: .sisyphus/evidence/task-W3.6-playback.png

  Scenario: Spectrum renders
    Tool: Playwright
    Steps:
      1. Load fixture; wait for spectrum canvas
      2. Screenshot; assert non-blank pixels in spectrum region
    Evidence: .sisyphus/evidence/task-W3.6-spectrum.png
  ```

  **Commit**: YES. `feat(renderer): wavesurfer.js v7 player with spectrum`. Files: `apps/renderer/components/player/**`, tests. Pre-commit: `bun test apps/renderer/tests/player.*`.

- [x] W3.7. Export dialog — format/bitrate selection + save-as

  **What to do**: Build `apps/renderer/components/export/ExportDialog.tsx` using shadcn `<Dialog>`, triggered from W3.6 player toolbar. Fields: `<RadioGroup>` for format (WAV/MP3/FLAC), conditional `<Slider>` for MP3 bitrate (64-320, default 192). Submit → POST `/export` (W2.6) with `{generation_id, format, bitrate_kbps?}`. On success, call Electron IPC `dialog:saveAs` (preload-exposed per W4.4) with returned file_path as source, user picks destination; then IPC `fs:copyFile` to move from sidecar tmp to user choice. Show shadcn `<Progress>` (indeterminate) during ffmpeg call. Toast success with "Reveal in Finder/Explorer" action (Electron `shell.showItemInFolder`). On EXPORT_FAILED, show error with hint from envelope. RED Playwright tests: format selection toggles bitrate visibility, submit flow with mocked IPC, error rendering.

  **Must NOT do**: Do NOT write to user-chosen path from sidecar (Electron-only write boundary). No silent overwrite — let OS dialog handle conflict. Do NOT block UI during ffmpeg (await with progress).

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES. Wave 3. Blocked by W3.1, W3.6, W2.6, W4.4 (IPC bridge).

  **References**: `apps/sidecar/src/audiomorph/routers/export.py` (W2.6), `https://www.electronjs.org/docs/latest/api/dialog#dialogshowsavedialogbrowserwindow-options`, `https://www.electronjs.org/docs/latest/api/shell#shellshowiteminfolderfullpath`. WHY: Round 3 export is core MVP; OS-native save dialog expected.

  **Acceptance Criteria**: All RED tests green; export completes + reveals file; error envelope hint visible.

  **QA Scenarios**:
  ```
  Scenario: MP3 export with bitrate selection
    Tool: Playwright
    Steps:
      1. Open dialog; select MP3; assert bitrate slider visible
      2. Set 320; submit; stub /export → {file_path:"/tmp/x.mp3"}
      3. Stub dialog:saveAs → "/Users/me/Music/song.mp3"
      4. Assert toast "Exported" with "Reveal" button
    Evidence: .sisyphus/evidence/task-W3.7-export-mp3.png

  Scenario: Export failure surfaces hint
    Tool: Playwright
    Steps:
      1. Stub /export → 500 with envelope EXPORT_FAILED hint:"ffmpeg not found"
      2. Submit; assert error toast contains "ffmpeg not found"
    Evidence: .sisyphus/evidence/task-W3.7-error.png
  ```

  **Commit**: YES. `feat(renderer): export dialog with format + bitrate`. Files: `apps/renderer/components/export/**`, tests. Pre-commit: `bun test apps/renderer/tests/export.*`.

- [x] W3.8. Lyrics workspace — transcribe from audio + manual editor

  **What to do**: Build `apps/renderer/app/lyrics/page.tsx` with two-panel layout (shadcn `<ResizablePanelGroup>`). Left: audio source picker — drag-drop zone (file/folder) OR select existing generation. On submit → POST `/lyrics/transcribe` (W2.4) with file_path, subscribe to SSE for progress, render timeline with detected segments + timestamps. Right: shadcn `<Textarea>` with line-numbered editor (CodeMirror-lite or simple textarea with overflow gutter), populated from transcription. Buttons: "Copy to clipboard", "Send to Generation Form" (Zustand → W3.4 lyrics field), "Save as .lrc" (Electron IPC saveAs). Magic UI `<Marquee>` showing example lyric snippets when empty. RED Playwright tests: drag-drop accepts WAV/MP3, transcription progress streams, send-to-form wires correctly, .lrc save format valid.

  **Must NOT do**: No upload to external services (W2.4 is fully local). Do NOT block UI during transcription. No autosave (explicit save only).

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES. Wave 3. Blocked by W3.1, W2.4, W4.4.

  **References**: `apps/sidecar/src/audiomorph/routers/lyrics.py` (W2.4), `https://ui.shadcn.com/docs/components/resizable`. WHY: Differentiator feature; matches HeartMuLa-Studio reverse-engineered scope.

  **Acceptance Criteria**: All RED tests green; transcription progress visible; .lrc file has valid `[mm:ss.xx]` timestamp format.

  **QA Scenarios**:
  ```
  Scenario: Drag-drop transcribe + send to form
    Tool: Playwright
    Steps:
      1. Drop fixtures/sample.wav onto zone
      2. Stub SSE progress 0→100; assert progress bar
      3. Stub final result with 3 segments; assert editor populated
      4. Click "Send to Generation Form"; navigate to /; assert lyrics field has text
    Evidence: .sisyphus/evidence/task-W3.8-transcribe.png

  Scenario: Save as .lrc
    Tool: Playwright
    Steps:
      1. Populate editor with sample segments
      2. Click Save; stub dialog:saveAs → "/tmp/song.lrc"
      3. Assert IPC called with .lrc content matching /^\[\d{2}:\d{2}\.\d{2}\]/m
    Evidence: .sisyphus/evidence/task-W3.8-lrc.txt
  ```

  **Commit**: YES. `feat(renderer): lyrics workspace with transcription`. Files: `apps/renderer/app/lyrics/**`, `components/lyrics/**`, tests. Pre-commit: `bun test apps/renderer/tests/lyrics.*`.

- [x] W3.9. Settings page — theme, keys, models dir, CPU fallback, about

  **What to do**: Build `apps/renderer/app/settings/page.tsx` with shadcn `<Tabs>`: General, API Keys, Storage, Advanced, About. **General**: `<Select>` theme (light/dark/system) → persists via `PUT /settings/theme` + applies via `data-theme` attr on `<html>`. **API Keys**: two `<Input type="password">` for Hugging Face token + OpenRouter key, each with "Save to system keychain" button → IPC `keytar:set` (W4.5), shows masked status badge (`••••set` or `not set`), "Remove" button → IPC `keytar:delete`. **Storage**: read-only display of models dir + free space + "Change…" button (IPC `dialog:openDirectory` + `PUT /settings/models_dir`, warns about re-download). **Advanced**: `<Switch>` for CPU fallback (`PUT /settings/cpu_fallback_enabled`), `<Switch>` placeholder for telemetry (always off + disabled with "telemetry disabled" note). **About**: app version, heartlib version, license, link to GitHub. RED Playwright tests: theme toggle updates DOM immediately, key save calls IPC + shows masked status, key never appears in DOM after save.

  **Must NOT do**: NEVER store keys in localStorage/sessionStorage/Zustand persistence. NEVER render raw key after save (mask only). No telemetry toggle that does anything (display-only per user "no telemetry" constraint).

  **Recommended Agent Profile**: `visual-engineering`, skills `[]`

  **Parallelization**: YES. Wave 3. Blocked by W3.1, W2.8, W4.5.

  **References**: `apps/sidecar/src/audiomorph/routers/settings.py` (W2.8), `https://www.npmjs.com/package/keytar`, `https://ui.shadcn.com/docs/components/tabs`. WHY: Centralizes user controls; key vault UI is the security UX surface.

  **Acceptance Criteria**: All RED tests green; theme persists across reload; key never visible after save (DOM grep test).

  **QA Scenarios**:
  ```
  Scenario: Theme toggle persists
    Tool: Playwright
    Steps:
      1. Open /settings; select Light; assert html[data-theme="light"]
      2. Reload; assert still Light
    Evidence: .sisyphus/evidence/task-W3.9-theme.png

  Scenario: Key save + masking
    Tool: Playwright
    Steps:
      1. Enter "sk-or-secret-9999" in OpenRouter field; click Save
      2. Stub IPC keytar:set; stub /settings → openrouter_key_present:true
      3. Assert badge shows "••••set"
      4. Assert document.body.innerText does NOT contain "sk-or-secret-9999"
    Evidence: .sisyphus/evidence/task-W3.9-key-masked.txt
  ```

  **Commit**: YES. `feat(renderer): settings page with theme + keys + storage`. Files: `apps/renderer/app/settings/**`, tests. Pre-commit: `bun test apps/renderer/tests/settings.*`.

- [x] W4.1. Electron shell scaffold + electron-builder config + BrowserWindow setup

  **What to do**: Initialize `apps/shell/` as TypeScript Electron app: `package.json` with `electron@latest`, `electron-builder`, `typescript`, `tsx` (dev runner). Create `src/main.ts` — single `BrowserWindow` (1440x900 default, min 1024x720, dark titleBarStyle: `hiddenInset` on macOS, frameless on Win/Linux with custom shadcn titlebar), `webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js')}`. Load `file://` to `apps/renderer/out/index.html` in production OR `http://localhost:3000` in dev. Add `app.whenReady()` → create window; `window-all-closed` → quit (except macOS). Wire `electron-builder.yml` skeleton with `appId: studio.audiomorph.app`, `productName: AudioMorph Studio`, targets defined as placeholders for W5 (mac dmg+zip, win nsis, linux AppImage+deb). Add `npm scripts`: `dev` (concurrently runs renderer + shell via tsx watch), `build:shell`, `build:all`, `dist:mac/win/linux`. RED test: shell boots, loads renderer URL, window dims match.

  **Must NOT do**: NEVER set `nodeIntegration: true`. NEVER disable `contextIsolation`. NEVER set `sandbox: false`. No remote module. No `webview` tag. Do NOT load any `http://` URL other than localhost dev.

  **Recommended Agent Profile**: `unspecified-high`, skills `[]`

  **Parallelization**: YES. Wave 4 entry. Blocks W4.2-W4.7. Blocked by P0.1, W3.1.

  **References**: External `https://www.electronjs.org/docs/latest/tutorial/security`, `https://www.electron.build/configuration/configuration`. WHY: Security baseline must be locked from task 1; any later relaxation = audit failure.

  **Acceptance Criteria**: RED test green; security audit (`electron-builder` doesn't warn); cold boot < 3s on dev machine.

  **QA Scenarios**:
  ```
  Scenario: Shell boots with secure defaults
    Tool: interactive_bash (tmux)
    Steps:
      1. cd apps/shell && bun run dev
      2. Wait for window; query webPreferences via test harness
      3. Assert contextIsolation=true, nodeIntegration=false, sandbox=true
      4. Screenshot window
    Evidence: .sisyphus/evidence/task-W4.1-boot.png
  ```

  **Commit**: YES. `feat(shell): Electron scaffold with hardened webPreferences`. Files: `apps/shell/**`, `electron-builder.yml`. Pre-commit: `cd apps/shell && bun run build:shell`.

- [x] W4.2. Sidecar lifecycle manager — spawn, port discovery, health check, graceful + force kill, zombie reaper

  **What to do**: Implement `apps/shell/src/sidecar/manager.ts` as singleton `SidecarManager` class. **Spawn**: Locate python-build-standalone runtime (per W1.6 layout) at `process.resourcesPath/python/<platform>/bin/python` (prod) or repo `.venv/bin/python` (dev). Spawn `python -m audiomorph.main --port 0 --token <generated 32-byte hex>` via `child_process.spawn` with `detached: false`, `stdio: ['ignore', 'pipe', 'pipe']`. Read stdout line-by-line; first line MUST be `{"event":"listening","port":N,"token":"..."}` JSON (W1.5 emits this on bind) — timeout 30s. **Port discovery**: capture port from JSON; expose via `getApiBaseUrl()` returning `http://127.0.0.1:${port}` and `getApiToken()`. **Health check**: poll `GET /healthz` every 5s in background; on 3 consecutive failures → emit `sidecar:unhealthy` event → attempt restart (max 3 in 5min, then surface fatal error to renderer). **Graceful shutdown**: on `app.before-quit` → POST `/internal/shutdown` (W1.5 endpoint) → wait 5s → if still alive, `SIGTERM` → wait 3s → `SIGKILL`. **Zombie reaper**: on Electron crash recovery boot, scan `<userData>/sidecar.pid` file — if pid alive AND cmdline matches `audiomorph.main`, send `SIGKILL` before respawn. Write own pid to `sidecar.pid` after spawn; delete on clean shutdown. **Logging**: stream sidecar stdout/stderr to `<userData>/logs/sidecar-<date>.log` (rotate at 10MB, keep 5). **Crash handling**: on unexpected exit (code !== 0 AND not during shutdown), emit `sidecar:crashed` with last 50 log lines for renderer toast. RED tests: spawn + handshake, port collision retry, graceful shutdown completes <8s, force-kill on hang, zombie cleanup on dirty restart, log rotation triggers.

  **Must NOT do**: NEVER spawn with `detached: true` (orphan risk). NEVER use `shell: true`. NEVER hardcode port — must use port 0 + discovery. Do NOT swallow stderr — always log. NEVER restart > 3 times in 5min (avoid infinite crash loop). Do NOT use system Python — only bundled runtime. NEVER expose raw token in logs (mask after first char).

  **Recommended Agent Profile**: `deep`, skills `[]`

  **Parallelization**: YES. Wave 4. Blocks W4.3 (IPC needs sidecar), W4.4, W4.6. Blocked by W4.1, W1.5, W1.6.

  **References**: File `apps/sidecar/src/audiomorph/main.py` (W1.5 handshake protocol). External `https://nodejs.org/api/child_process.html#child_processspawncommand-args-options`, `https://www.electronjs.org/docs/latest/api/app#event-before-quit`, `https://www.electronjs.org/docs/latest/tutorial/process-model`. WHY: **Metis flagged "sidecar zombies" as #1 blocking gap** — every code path (clean quit, crash, dirty restart, OS kill) MUST be covered. This is the single most failure-prone integration.

  **Acceptance Criteria**: All RED tests green; zombie reaper verified by manually `kill -9` Electron during gen + restart → no leaked sidecar; graceful shutdown <8s p99 over 50 iterations; logs rotated correctly.

  **QA Scenarios**:
  ```
  Scenario: Spawn + handshake (happy path)
    Tool: interactive_bash
    Steps:
      1. Boot shell in dev mode
      2. tail -f ~/Library/Application Support/AudioMorph Studio/logs/sidecar-*.log
      3. Assert "listening" event line within 30s
      4. curl http://127.0.0.1:$PORT/healthz with token header → 200
    Evidence: .sisyphus/evidence/task-W4.2-spawn.txt

  Scenario: Graceful shutdown completes
    Tool: interactive_bash
    Steps:
      1. Boot shell; capture sidecar pid from sidecar.pid file
      2. Send SIGTERM to Electron process
      3. Poll `kill -0 $SIDECAR_PID` every 500ms; expect "no such process" within 8s
      4. Assert sidecar.pid file deleted
    Evidence: .sisyphus/evidence/task-W4.2-shutdown.txt

  Scenario: Zombie reaper on dirty restart
    Tool: interactive_bash
    Steps:
      1. Boot shell; note sidecar pid
      2. `kill -9` Electron (simulates crash, sidecar.pid stays)
      3. Verify sidecar still running (`kill -0 $PID` succeeds)
      4. Restart shell; assert old sidecar killed within 3s of boot
      5. Assert new sidecar spawned with different pid
    Evidence: .sisyphus/evidence/task-W4.2-zombie-reap.txt

  Scenario: Restart loop guard
    Tool: interactive_bash
    Steps:
      1. Inject failing python (returns non-zero immediately)
      2. Boot shell; observe 3 restart attempts within 5min then fatal error event
      3. Assert renderer receives `sidecar:fatal` event
    Evidence: .sisyphus/evidence/task-W4.2-restart-guard.txt

  Scenario: Port collision retry
    Tool: interactive_bash
    Steps:
      1. Mock port-0 to return already-bound port first attempt
      2. Boot shell; assert spawn retries with new port-0 request
      3. Assert successful handshake on retry
    Evidence: .sisyphus/evidence/task-W4.2-port-collision.txt
  ```

  **Commit**: YES. `feat(shell): sidecar lifecycle manager with zombie reaper`. Files: `apps/shell/src/sidecar/**`, `apps/shell/tests/sidecar.*`. Pre-commit: `cd apps/shell && bun test sidecar.*`.

- [x] W4.3. IPC bridge — typed channels, request/response, SSE forwarding, error envelope passthrough

  **What to do**: Implement `apps/shell/src/ipc/bridge.ts` exposing typed IPC handlers via `ipcMain.handle` for renderer↔main. **Channels**: `api:request` (generic HTTP proxy: `{method, path, body?, signal?}` → forwards to `getApiBaseUrl() + path` with `Authorization: Bearer <token>` header injected, returns `{status, body}` — keeps token OUT of renderer); `api:stream` (SSE: opens `EventSource`-like via `fetch` ReadableStream, forwards `data:` events to renderer via `webContents.send('api:stream:event', {streamId, event, data})`, supports cancel via `api:stream:cancel`); `dialog:saveAs` (wraps `dialog.showSaveDialog`), `dialog:openDirectory` (wraps `dialog.showOpenDialog` with `properties: ['openDirectory']`), `dialog:openFile` (multi-file picker for audio/lyrics); `fs:copyFile` (validates source is in sidecar tmp dir OR userData; rejects arbitrary paths), `fs:readFile` (size-limited 10MB, mime-checked); `shell:openExternal` (URL allowlist: huggingface.co, openrouter.ai, github.com only), `shell:showItemInFolder`. **Error envelope passthrough**: when sidecar returns 4xx/5xx with envelope `{error: {code, message, hint?}}`, forward verbatim — never wrap or transform. **Cancellation**: each `api:request` accepts `requestId`; renderer can call `api:cancel` with same id → `AbortController.abort()`. **Token security**: token NEVER serialized to renderer, NEVER logged. **Type contracts**: shared `packages/ipc-contracts/` with TS types imported by both shell and renderer. RED tests: each channel happy path + error path, SSE forwarding completes + cancels, token not leaked to renderer process, fs:copyFile rejects path traversal, shell:openExternal rejects non-allowlisted URLs.

  **Must NOT do**: NEVER expose token to renderer (even masked). NEVER allow arbitrary file path reads — always validate against allowlist (sidecar tmp, userData, user-picked via dialog). NEVER use `ipcMain.on` for handlers (use `handle` for typed promise-based). NEVER open arbitrary URLs in shell.openExternal (allowlist only — prevents phishing via crafted markdown). Do NOT pass `signal` directly from renderer (recreate AbortController in main). NEVER log full request body (PII risk — log only path + status).

  **Recommended Agent Profile**: `deep`, skills `[]`

  **Parallelization**: YES. Wave 4. Blocks W4.4 (preload uses these channels), all W3.* renderer calls. Blocked by W4.1, W4.2.

  **References**: Files `apps/shell/src/sidecar/manager.ts` (W4.2 for getApiBaseUrl/getApiToken). External `https://www.electronjs.org/docs/latest/tutorial/ipc`, `https://www.electronjs.org/docs/latest/api/ipc-main#ipcmainhandlechannel-listener`, `https://www.electronjs.org/docs/latest/tutorial/security#3-enable-context-isolation`. WHY: **Metis flagged "token leakage" + "arbitrary fs access" as high-risk** — IPC bridge is the security boundary. Wrong design = full filesystem compromise.

  **Acceptance Criteria**: All RED tests green; token grep across renderer build = 0 matches; path traversal attempts (e.g. `../../../etc/passwd`) rejected; SSE streams handle backpressure (renderer slow consumer doesn't OOM main).

  **QA Scenarios**:
  ```
  Scenario: api:request proxies with token injection (token never reaches renderer)
    Tool: interactive_bash
    Steps:
      1. Boot shell+sidecar; renderer calls ipc.invoke('api:request', {method:'GET', path:'/healthz'})
      2. Capture sidecar access log; assert Authorization header present
      3. Grep entire renderer process heap dump for token; assert 0 matches
      4. Assert response body returned to renderer
    Evidence: .sisyphus/evidence/task-W4.3-token-isolation.txt

  Scenario: SSE forwarding + cancel
    Tool: interactive_bash
    Steps:
      1. Renderer opens api:stream to /generate (stub sidecar emits 10 events over 5s)
      2. Assert renderer receives all 10 events via api:stream:event
      3. Mid-stream, renderer calls api:stream:cancel; assert sidecar request aborted within 500ms
      4. Assert no further events sent to renderer
    Evidence: .sisyphus/evidence/task-W4.3-sse.txt

  Scenario: Path traversal rejected
    Tool: interactive_bash
    Steps:
      1. Renderer calls fs:copyFile with source="/tmp/sidecar/../../etc/passwd"
      2. Assert rejection with error code "PATH_NOT_ALLOWED"
      3. Assert no file written
    Evidence: .sisyphus/evidence/task-W4.3-traversal.txt

  Scenario: shell.openExternal allowlist
    Tool: interactive_bash
    Steps:
      1. Renderer calls shell:openExternal with "https://evil.example.com"
      2. Assert rejection with "URL_NOT_ALLOWED"
      3. Renderer calls with "https://huggingface.co/HeartMuLa/HeartMuLaGen"
      4. Assert opens (stub shell.openExternal verifies call)
    Evidence: .sisyphus/evidence/task-W4.3-allowlist.txt

  Scenario: Error envelope passthrough verbatim
    Tool: interactive_bash
    Steps:
      1. Stub sidecar /generate → 503 {error:{code:"OUT_OF_MEMORY",message:"...",hint:"retry at half batch"}}
      2. Renderer calls api:request; assert returned {status:503, body:{error:{...}}} matches verbatim
    Evidence: .sisyphus/evidence/task-W4.3-envelope.txt
  ```

  **Commit**: YES. `feat(shell): typed IPC bridge with security boundaries`. Files: `apps/shell/src/ipc/**`, `packages/ipc-contracts/**`, tests. Pre-commit: `cd apps/shell && bun test ipc.*`.

- [x] W4.4. Preload bridge — contextBridge.exposeInMainWorld + typed window.api

  **What to do**: Implement `apps/shell/src/preload.ts` using `contextBridge.exposeInMainWorld('api', {...})` exposing typed wrappers around W4.3 IPC channels: `request(method, path, body?, opts?)`, `stream(path, body?, onEvent, signal)`, `dialog.saveAs(opts)`, `dialog.openDirectory()`, `dialog.openFile(opts)`, `fs.copyFile(src, dst)`, `shell.openExternal(url)`, `shell.showItemInFolder(path)`, `app.getVersion()`, `app.getPath('userData'|'downloads')`. Also expose `window.apiBaseUrl` (HTTP URL for direct fetch when needed — token-less endpoints only like `/healthz`). Generate TypeScript ambient declaration `apps/renderer/types/window.d.ts` so renderer has `window.api` typed. RED tests: contextBridge surface matches contract, no Node globals leak, all methods are functions.

  **Must NOT do**: NEVER expose `ipcRenderer` directly. NEVER expose `require`, `process`, `Buffer`, or any Node global. NEVER expose token-injecting endpoints without IPC proxy. Do NOT use `webFrame.executeJavaScript`.

  **Recommended Agent Profile**: `unspecified-high`, skills `[]`

  **Parallelization**: YES. Wave 4. Blocked by W4.3. Blocks all renderer IPC consumers (W3.7-W3.9 use this).

  **References**: External `https://www.electronjs.org/docs/latest/api/context-bridge`. WHY: Surface area of `window.api` IS the renderer's privileged capability set — minimal + typed.

  **Acceptance Criteria**: RED tests green; `window.process`, `window.require` undefined in renderer; all `window.api.*` typed in renderer TS.

  **QA Scenarios**:
  ```
  Scenario: Surface area minimal + typed
    Tool: Playwright
    Steps:
      1. Boot app; in renderer console eval typeof window.require
      2. Assert "undefined"
      3. Assert typeof window.api.request === "function"
      4. Assert Object.keys(window.api).sort() matches contract snapshot
    Evidence: .sisyphus/evidence/task-W4.4-surface.txt
  ```

  **Commit**: YES. `feat(shell): preload contextBridge with typed window.api`. Files: `apps/shell/src/preload.ts`, `apps/renderer/types/window.d.ts`, tests. Pre-commit: `cd apps/shell && bun test preload.*`.

- [x] W4.5. Key vault — keytar/safeStorage for HF token + OpenRouter key, IPC handlers

  **What to do**: Implement `apps/shell/src/security/keyvault.ts` as singleton `KeyVault` class wrapping OS-native credential storage. **Primary**: `keytar@latest` (libsecret on Linux, Keychain on macOS, Credential Vault on Windows) with service name `studio.audiomorph.app` and accounts `hf_token`, `openrouter_key`. **Fallback**: if keytar unavailable (rare Linux without libsecret), fall back to `safeStorage` (Electron's OS-encrypted local store) writing to `<userData>/secrets.enc` — log warning at first use. **IPC handlers** (registered in W4.3 bridge): `keytar:set({account, secret})` — validates `account ∈ {hf_token, openrouter_key}`, validates secret format per type (HF: `hf_` prefix + 32+ chars; OpenRouter: `sk-or-` prefix + 32+ chars), stores, returns `{ok: true}`; `keytar:get({account})` — **NEVER returns to renderer**, only used internally by IPC bridge when sidecar/external HTTP requires it; renderer can only call `keytar:isSet({account})` returning boolean; `keytar:delete({account})` — removes from vault. **Sidecar integration**: when shell needs to inject HF token into sidecar requests (e.g., model download via `huggingface_hub`), bridge fetches from KeyVault and passes via `Authorization` or `HF_TOKEN` env at sidecar spawn (NOT per-request to avoid log leak). On startup, if `hf_token` is set, pass via env to sidecar spawn (W4.2 reads from KeyVault before spawn). **Audit log**: every `set`/`delete` writes timestamp + account name (NEVER secret) to `<userData>/logs/keyvault-audit.log`. RED tests: roundtrip set/get/delete, format validation rejects bad keys, isSet returns correctly, get NEVER reachable from renderer (IPC contract enforces), fallback to safeStorage when keytar throws, audit log written.

  **Must NOT do**: NEVER store secrets in SQLite. NEVER store in localStorage/sessionStorage. NEVER log raw secret value (mask after 4th char in any log line). NEVER return secret to renderer (IPC contract MUST omit `keytar:get` from preload surface — only `isSet` exposed). NEVER pass secret as command-line arg to sidecar (visible in `ps`). NEVER fall back to plaintext file storage — safeStorage IS the fallback (already OS-encrypted). NEVER cache decrypted secret in JS variables beyond single use.

  **Recommended Agent Profile**: `deep`, skills `[]`

  **Parallelization**: YES. Wave 4. Blocked by W4.1. Blocks W3.9 settings page integration, W4.3 (token injection paths), W4.2 (sidecar env at spawn).

  **References**: External `https://www.npmjs.com/package/keytar`, `https://www.electronjs.org/docs/latest/api/safe-storage`, `https://huggingface.co/docs/hub/security-tokens`. WHY: **Metis flagged "key storage" as #1 security gap** — wrong storage = credential theft. Round 3 mandates BYOK with system keychain; renderer NEVER touches plaintext.

  **Acceptance Criteria**: All RED tests green; static analysis confirms `keytar:get` NOT in preload surface (W4.4); audit log present after each op; grep entire renderer build for any keytar/safeStorage reference = 0 matches.

  **QA Scenarios**:
  ```
  Scenario: Roundtrip set + isSet + delete
    Tool: interactive_bash
    Steps:
      1. Boot shell; call IPC keytar:set {account:"hf_token", secret:"hf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
      2. Verify via `security find-generic-password -s studio.audiomorph.app -a hf_token` (macOS) or equivalent
      3. Call keytar:isSet {account:"hf_token"} → expect true
      4. Call keytar:delete {account:"hf_token"}; verify removed from OS vault
    Evidence: .sisyphus/evidence/task-W4.5-roundtrip.txt

  Scenario: Format validation rejects bad keys
    Tool: interactive_bash
    Steps:
      1. Call keytar:set {account:"openrouter_key", secret:"not-a-real-key"}
      2. Assert returns {error:{code:"INVALID_KEY_FORMAT"}}
      3. Verify NOT written to vault
    Evidence: .sisyphus/evidence/task-W4.5-validation.txt

  Scenario: Renderer cannot retrieve secret
    Tool: Playwright
    Steps:
      1. In renderer DevTools, attempt window.api.keytar.get({account:"hf_token"})
      2. Assert TypeError (function does not exist)
      3. Assert window.api.keytar contains only {set, isSet, delete} keys
    Evidence: .sisyphus/evidence/task-W4.5-no-get.txt

  Scenario: Sidecar receives HF token via env (not argv)
    Tool: interactive_bash
    Steps:
      1. Set hf_token via IPC
      2. Restart shell; capture sidecar process via `ps -E -o pid,command` (env visible only in /proc on Linux)
      3. Assert HF_TOKEN NOT in argv (no token visible in `ps` output)
      4. Assert sidecar logs report token loaded from env
    Evidence: .sisyphus/evidence/task-W4.5-env-injection.txt

  Scenario: Fallback to safeStorage when keytar fails
    Tool: interactive_bash
    Steps:
      1. Mock keytar to throw "libsecret not available"
      2. Call keytar:set; assert safeStorage fallback used (warning logged)
      3. Verify <userData>/secrets.enc exists and is NOT plaintext (entropy check)
      4. Restart; verify isSet still true (persistence works)
    Evidence: .sisyphus/evidence/task-W4.5-fallback.txt

  Scenario: Audit log written without secret
    Tool: interactive_bash
    Steps:
      1. Set hf_token "hf_test12345678901234567890123456"
      2. Read <userData>/logs/keyvault-audit.log
      3. Assert line "set hf_token at <iso>" present
      4. grep audit log for "hf_test" → assert 0 matches
    Evidence: .sisyphus/evidence/task-W4.5-audit.txt
  ```

  **Commit**: YES. `feat(shell): key vault with keytar primary + safeStorage fallback`. Files: `apps/shell/src/security/keyvault.ts`, `apps/shell/tests/keyvault.*`. Pre-commit: `cd apps/shell && bun test keyvault.*`.

- [x] W4.6. App lifecycle, menu, dock — single-instance lock, deep-link handler stub, native menu, dock icon

  **What to do**: In `apps/shell/src/main.ts`, add `app.requestSingleInstanceLock()` — if not primary, `app.quit()`. On `second-instance` event, focus existing window. Build native menu via `Menu.buildFromTemplate`: standard macOS menu (App/Edit/View/Window/Help) with custom items "Open Models Folder" (`shell.openPath(modelsDir)`), "View Logs" (open `<userData>/logs/`), "Check Hardware" (renderer route /diagnostics). Set dock icon (macOS) from `apps/shell/resources/icon.png` (512x512). Register `app.on('open-url')` for `audiomorph://` deep-link stub (no-op now, logs for future). Wire app menu Quit → triggers W4.2 graceful shutdown. RED test: single-instance lock prevents 2nd launch, menu has expected items, dock icon set.

  **Must NOT do**: Do NOT register file-type associations yet (defer to W5). Do NOT add native context menu in renderer (renderer handles via shadcn). NEVER skip single-instance lock (multiple sidecars = port collision).

  **Recommended Agent Profile**: `quick`, skills `[]`

  **Parallelization**: YES. Wave 4. Blocked by W4.1, W4.2. Independent of W4.3-W4.5.

  **References**: External `https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelock`, `https://www.electronjs.org/docs/latest/api/menu`. WHY: Single-instance lock is critical for port-bound sidecar — concurrent shells would fight for port.

  **Acceptance Criteria**: RED tests green; manual 2nd launch focuses 1st window; quit from menu triggers graceful shutdown path.

  **QA Scenarios**:
  ```
  Scenario: Single-instance lock
    Tool: interactive_bash
    Steps:
      1. Launch app; note pid
      2. Launch app again; assert 2nd process exits within 2s
      3. Assert 1st window focused (capture via screencapture)
    Evidence: .sisyphus/evidence/task-W4.6-lock.png
  ```

  **Commit**: YES. `feat(shell): app lifecycle + menu + single-instance lock`. Files: `apps/shell/src/main.ts`, `apps/shell/resources/icon.png`, tests. Pre-commit: `cd apps/shell && bun test lifecycle.*`.

- [x] W4.7. Crash reporter (local-only) + auto-update DISABLED guard

  **What to do**: In `apps/shell/src/main.ts`, call `crashReporter.start({submitURL: '', uploadToServer: false, compress: false})` — captures crash dumps to `<userData>/Crashpad/` for local debugging only, NEVER uploads. Add lint rule + runtime assertion that `autoUpdater` is NOT imported (per user "no auto-update" constraint) — `apps/shell/.eslintrc.js` forbids `electron-updater` and `electron.autoUpdater`. Add startup self-check: `if ('autoUpdater' in app) { /* still don't call .checkForUpdates */ }`. Document in `apps/shell/README.md` the manual update process (re-download installer). RED tests: crash dump path created, lint catches autoUpdater import, no network call on boot (sniff via mocked net module).

  **Must NOT do**: NEVER call `autoUpdater.setFeedURL`, `checkForUpdates`, `quitAndInstall`. NEVER enable crash upload (`uploadToServer: true` forbidden). NEVER add update-check UI.

  **Recommended Agent Profile**: `quick`, skills `[]`

  **Parallelization**: YES. Wave 4. Blocked by W4.1. Independent of W4.2-W4.6.

  **References**: External `https://www.electronjs.org/docs/latest/api/crash-reporter`. WHY: User explicitly excluded auto-update + telemetry; lint guard prevents accidental re-introduction.

  **Acceptance Criteria**: RED tests green; `npm run lint` fails if autoUpdater import added; boot generates 0 outbound connections (verified via `lsof -i` snapshot).

  **QA Scenarios**:
  ```
  Scenario: No outbound network on boot
    Tool: interactive_bash
    Steps:
      1. Boot shell with sidecar disabled (skip W4.2 spawn)
      2. After window loads, run `lsof -iTCP -sTCP:ESTABLISHED -p $ELECTRON_PID`
      3. Assert 0 connections to non-127.0.0.1 hosts
    Evidence: .sisyphus/evidence/task-W4.7-no-network.txt

  Scenario: Lint catches autoUpdater import
    Tool: Bash
    Steps:
      1. echo "import { autoUpdater } from 'electron';" >> apps/shell/src/main.ts
      2. cd apps/shell && bun run lint
      3. Assert exit code !=0 and error mentions autoUpdater
      4. Revert change
    Evidence: .sisyphus/evidence/task-W4.7-lint.txt
  ```

  **Commit**: YES. `feat(shell): local crash reporter + auto-update lint guard`. Files: `apps/shell/src/main.ts`, `apps/shell/.eslintrc.js`, `apps/shell/README.md`, tests. Pre-commit: `cd apps/shell && bun run lint && bun test crash-reporter.*`.

- [x] W5.1. macOS installer — universal/arm64 build, codesign, notarize, staple, DMG + ZIP

  **What to do**: Configure `electron-builder.yml` `mac` section: `target: [{target: 'dmg', arch: ['arm64']}, {target: 'zip', arch: ['arm64']}]`, `category: public.app-category.music`, `hardenedRuntime: true`, `gatekeeperAssess: false`, `entitlements: build/entitlements.mac.plist`, `entitlementsInherit: build/entitlements.mac.plist`, `notarize: true`. Write `build/entitlements.mac.plist` with: `com.apple.security.cs.allow-unsigned-executable-memory` (for PyTorch JIT), `com.apple.security.cs.allow-jit` (for ML inference), `com.apple.security.cs.disable-library-validation` (for bundled python dylibs), `com.apple.security.cs.allow-dyld-environment-variables` (for sidecar DYLD_LIBRARY_PATH). **Signing**: env vars `CSC_LINK` (Developer ID cert .p12 base64) + `CSC_KEY_PASSWORD`. **Notarization**: env vars `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; electron-builder calls `notarytool submit --wait`. **Stapling**: post-notarize, `xcrun stapler staple` runs automatically via electron-builder. **Sidecar signing**: python-build-standalone binaries inside `Contents/Resources/python/` MUST be signed individually — add `afterPack` hook script `build/sign-python.js` that walks `python/` dir + runs `codesign --force --options runtime --entitlements entitlements.mac.plist --sign "$CSC_NAME"` on every executable and .dylib (find by Mach-O magic). Run before electron-builder's app-level sign. **Build script**: `scripts/build-mac.sh` — checks env vars present, runs `bun run build:all && electron-builder --mac --arm64`. **Verification**: post-build, run `spctl -a -vvv -t install AudioMorph\ Studio.app` (expect "accepted, source=Notarized Developer ID") + `codesign --verify --deep --strict AudioMorph\ Studio.app`. RED tests: entitlements file valid plist, sign-python hook finds all binaries, build script env-var guard rejects missing creds, dry-run electron-builder generates expected target list.

  **Must NOT do**: NEVER ship without notarization (Gatekeeper blocks on macOS 10.15+). NEVER use `--deep` codesign on the whole .app (electron-builder signs structure correctly; --deep breaks framework signing). NEVER commit `.p12` cert or App Store Connect password (env-only). NEVER set `hardenedRuntime: false` (notarization requires it). NEVER omit `allow-unsigned-executable-memory` entitlement (PyTorch needs JIT). Do NOT use ad-hoc signing for distribution.

  **Recommended Agent Profile**: `deep`, skills `[]`

  **Parallelization**: YES. Wave 5. Blocked by W4.* (all shell tasks). Independent of W5.2-W5.5.

  **References**: External `https://www.electron.build/configuration/mac`, `https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution`, `https://gregoryszorc.com/docs/python-build-standalone/main/distributions.html#macos-distributions`. WHY: **Metis flagged "macOS notarization with bundled python" as #1 packaging risk** — sidecar binaries are the most likely cause of notarization rejection because each python dylib must be signed with proper entitlements.

  **Acceptance Criteria**: All RED tests green; signed+notarized DMG passes `spctl` check; fresh macOS VM install (Gatekeeper enabled) opens without warning; sidecar spawns from notarized bundle without "killed: 9" (entitlement issue).

  **QA Scenarios**:
  ```
  Scenario: Sign all python binaries before app sign
    Tool: interactive_bash
    Steps:
      1. CSC_LINK/PASSWORD set; run scripts/build-mac.sh
      2. After afterPack hook, inspect dist/mac-arm64/AudioMorph\ Studio.app/Contents/Resources/python/
      3. For each *.dylib + bin/python3.14, run `codesign -dvvv` and assert "Authority=Developer ID Application"
      4. Assert hardened runtime flag set
    Evidence: .sisyphus/evidence/task-W5.1-python-sign.txt

  Scenario: Notarized DMG passes Gatekeeper
    Tool: interactive_bash
    Steps:
      1. Build with all env vars set (real Apple ID)
      2. Wait for notarytool completion (5-15min)
      3. Run `spctl -a -vvv -t install dist/AudioMorph\ Studio-*.dmg`
      4. Assert output "accepted, source=Notarized Developer ID"
      5. Run `stapler validate dist/AudioMorph\ Studio-*.dmg` → "validated"
    Evidence: .sisyphus/evidence/task-W5.1-spctl.txt

  Scenario: Sidecar runs in notarized bundle
    Tool: interactive_bash
    Steps:
      1. Mount DMG; copy app to /Applications
      2. Launch from Finder (not via terminal — full Gatekeeper path)
      3. Tail Console.app for "killed: 9" or codesign errors
      4. Verify sidecar handshake completes (W4.2 logs)
    Evidence: .sisyphus/evidence/task-W5.1-runtime.txt

  Scenario: Build script rejects missing creds
    Tool: Bash
    Steps:
      1. unset CSC_LINK; run scripts/build-mac.sh
      2. Assert exit code !=0 with error "CSC_LINK required"
    Evidence: .sisyphus/evidence/task-W5.1-env-guard.txt
  ```

  **Commit**: YES. `feat(packaging): macOS arm64 signed + notarized DMG/ZIP`. Files: `electron-builder.yml`, `build/entitlements.mac.plist`, `build/sign-python.js`, `scripts/build-mac.sh`, tests. Pre-commit: `bun test packaging/mac.*`.

- [x] W5.2. Windows installer — NSIS x64 with CUDA detection prompt + code signing (optional)

  **What to do**: Configure `electron-builder.yml` `win` section: `target: [{target: 'nsis', arch: ['x64']}]`, `icon: build/icon.ico`, `publisherName: AudioMorph Studio`, `verifyUpdateCodeSignature: false` (no auto-update). NSIS config: `oneClick: false` (custom install dir), `allowToChangeInstallationDirectory: true`, `perMachine: false` (per-user to avoid UAC), `createDesktopShortcut: true`, `createStartMenuShortcut: true`, `installerIcon: build/installer.ico`, `uninstallerIcon: build/uninstaller.ico`, `include: build/installer.nsh` (custom script). Custom `installer.nsh` adds preinstall check: runs PowerShell snippet `Get-CimInstance Win32_VideoController | Where-Object {$_.Name -like '*NVIDIA*'}` — if empty, show MessageBox "NVIDIA GPU required. Install anyway?" (per W5.4 hardware gating: actually REFUSE if user picked "Refuse to install" path — see W5.4). **Signing (optional)**: if `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` env set, electron-builder signs .exe with SignTool; else unsigned (SmartScreen warning expected — documented in README). **Build script**: `scripts/build-win.sh` (runs on macOS/Linux via wine OR on Windows runner) — `bun run build:all && electron-builder --win --x64`. RED tests: NSIS config valid, custom script runs PowerShell, builds .exe with expected size (>500MB with bundled python+models-empty).

  **Must NOT do**: NEVER ship `perMachine: true` (avoid UAC complexity for MVP). NEVER auto-install CUDA drivers (out of scope — refer user to NVIDIA). NEVER skip GPU check (W5.4 mandates).

  **Recommended Agent Profile**: `unspecified-high`, skills `[]`

  **Parallelization**: YES. Wave 5. Blocked by W4.*, W5.4 (hardware gating logic). Independent of W5.1, W5.3.

  **References**: External `https://www.electron.build/configuration/nsis`, `https://nsis.sourceforge.io/Docs/Chapter4.html#flags`. WHY: Round 3 mandates "Refuse to install" without NVIDIA — installer is the enforcement point.

  **Acceptance Criteria**: RED tests green; signed (if creds) or unsigned .exe installs on Win11 VM; NVIDIA check fires on non-GPU VM and blocks per W5.4.

  **QA Scenarios**:
  ```
  Scenario: NVIDIA check blocks install on no-GPU VM
    Tool: interactive_bash
    Steps:
      1. Spin up Win11 VM without GPU passthrough
      2. Run installer; assert MessageBox shows "NVIDIA GPU required"
      3. Click "No"; assert installer exits cleanly
    Evidence: .sisyphus/evidence/task-W5.2-gpu-block.png

  Scenario: Install succeeds on GPU VM
    Tool: interactive_bash
    Steps:
      1. Win11 VM with NVIDIA GPU passthrough
      2. Run installer; complete wizard
      3. Launch from Start Menu; assert shell boots + sidecar handshake
    Evidence: .sisyphus/evidence/task-W5.2-install-ok.png
  ```

  **Commit**: YES. `feat(packaging): Windows NSIS installer with GPU gate`. Files: `electron-builder.yml`, `build/installer.nsh`, `build/icon.ico`, `scripts/build-win.sh`, tests. Pre-commit: `bun test packaging/win.*`.

- [x] W5.3. Linux installer — AppImage + .deb x64 with CUDA detection script

  **What to do**: Configure `electron-builder.yml` `linux` section: `target: [{target: 'AppImage', arch: ['x64']}, {target: 'deb', arch: ['x64']}]`, `category: AudioVideo;Audio`, `synopsis: AI music generation studio`, `description: Local AI music generation powered by heartlib`, `desktop: {Name: 'AudioMorph Studio', Comment: 'AI music generation', Categories: 'AudioVideo;Audio;Music;'}`, `icon: build/icons/` (multi-res). For .deb: `depends: ['libnotify4', 'libsecret-1-0', 'libnss3', 'libxss1', 'libgtk-3-0', 'libatk-bridge2.0-0', 'libgbm1']` (Electron runtime + libsecret for W4.5 keytar). **Pre-install GPU check**: add `build/postinst.sh` (for .deb) + AppImage launcher wrapper script that runs `nvidia-smi` — if missing/fails, print red error "NVIDIA GPU required" and exit. AppImage: package via electron-builder default; ensure FUSE mention in README (modern distros auto-handle). **Build script**: `scripts/build-linux.sh` — `bun run build:all && electron-builder --linux --x64`. RED tests: desktop file valid (validate via `desktop-file-validate`), .deb deps resolvable on Ubuntu 24.04, postinst script syntax valid (`bash -n`).

  **Must NOT do**: NEVER ship .rpm (out of MVP scope). NEVER skip libsecret dep (keytar requires it). NEVER auto-install CUDA driver (out of scope).

  **Recommended Agent Profile**: `unspecified-high`, skills `[]`

  **Parallelization**: YES. Wave 5. Blocked by W4.*, W5.4. Independent of W5.1, W5.2.

  **References**: External `https://www.electron.build/configuration/linux`, `https://docs.appimage.org/`. WHY: User listed Linux+CUDA as supported platform.

  **Acceptance Criteria**: RED tests green; AppImage runs on Ubuntu 24.04 + Fedora 41 with NVIDIA GPU; .deb installs cleanly + uninstalls cleanly.

  **QA Scenarios**:
  ```
  Scenario: .deb install on Ubuntu 24.04 with GPU
    Tool: interactive_bash
    Steps:
      1. Ubuntu 24.04 VM with NVIDIA passthrough + nvidia-driver-550 installed
      2. dpkg -i dist/audiomorph-studio_*.deb
      3. Assert no missing deps; launch via desktop entry
      4. Assert sidecar handshake completes
    Evidence: .sisyphus/evidence/task-W5.3-deb-install.txt

  Scenario: AppImage blocks on no-GPU
    Tool: interactive_bash
    Steps:
      1. Ubuntu VM without GPU
      2. chmod +x AudioMorph-Studio-*.AppImage && ./AudioMorph-Studio-*.AppImage
      3. Assert stderr "NVIDIA GPU required" + exit code 1
    Evidence: .sisyphus/evidence/task-W5.3-appimage-block.txt
  ```

  **Commit**: YES. `feat(packaging): Linux AppImage + .deb with GPU gate`. Files: `electron-builder.yml`, `build/postinst.sh`, `build/icons/**`, `scripts/build-linux.sh`, tests. Pre-commit: `bun test packaging/linux.*`.

- [x] W5.4. Hardware gating — installer-time + runtime GPU/RAM/disk detection with "Refuse to install" enforcement

  **What to do**: Centralize hardware detection in `packages/hardware-gate/` (shared TS + native scripts). **Detection matrix**:
  - **macOS**: arm64 only (refuse Intel); detect via `sysctl -n hw.optional.arm64` == 1; RAM ≥ 16GB via `sysctl hw.memsize`; free disk ≥ 30GB on user volume.
  - **Windows**: x64 only; NVIDIA GPU present via `Get-CimInstance Win32_VideoController | ?{$_.Name -like '*NVIDIA*'}`; CUDA driver via `nvidia-smi` exit code 0; VRAM ≥ 8GB via `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits`; RAM ≥ 16GB; free disk ≥ 30GB on install drive.
  - **Linux**: x64 only; same NVIDIA checks as Windows via `nvidia-smi`; same RAM/disk thresholds.

  **Enforcement points** (defense in depth):
  1. **Installer-time** (W5.2 NSIS, W5.3 postinst, W5.1 entitlements assume arm64): block install with clear error referring to `https://github.com/<user>/audiomorph-studio#system-requirements`.
  2. **First-launch** (in W4.6 lifecycle): run `hardware-gate` check before window opens; on failure, show native `dialog.showErrorBox` with specific failing requirement (e.g., "Insufficient VRAM: 6GB detected, 8GB required") + Quit button. Set `app.exit(1)`.
  3. **Per-generation** (in W2.3 generation route): re-check VRAM free at request time; if < 6GB free (safety margin), return 503 `INSUFFICIENT_VRAM` with hint "Close other GPU apps".

  Implement `packages/hardware-gate/src/detect.ts` with platform-specific spawning of native commands. Returns `HardwareReport { ok: boolean, failures: HardwareFailure[], details: {os, arch, gpu, vram_gb, ram_gb, disk_gb} }`. Renderer settings page (W3.9) calls IPC `hardware:check` and renders report in /diagnostics. RED tests with mocked `child_process.exec`: each platform returns expected report; thresholds enforced exactly (15.9GB RAM → fail, 16.0GB → pass); each failure produces actionable message.

  **Must NOT do**: NEVER soft-fail (per user "Refuse to install"). NEVER skip hardware check at first launch (installer-time alone insufficient — GPU could be removed). NEVER allow "I know what I'm doing" override (out of MVP scope). Do NOT depend on heartlib for detection (must work BEFORE sidecar spawns to give clean error). NEVER use `wmic` on Windows (deprecated; use PowerShell `Get-CimInstance`). Do NOT assume `nvidia-smi` in PATH — search common install dirs as fallback.

  **Recommended Agent Profile**: `deep`, skills `[]`

  **Parallelization**: YES. Wave 5. Blocked by W4.6 (first-launch hook integration), W3.9 (settings page consumer). Blocks W5.2, W5.3 (installer integration), W5.5 (release checklist).

  **References**: External `https://docs.nvidia.com/deploy/nvidia-smi/index.html`, `https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance`. Internal `packages/api-client/` for shared error type pattern. WHY: **Metis flagged "hardware mismatch on launch" as crash-prone** — heartlib will OOM ungracefully without VRAM check. Round 3 mandated "Refuse to install" explicitly.

  **Acceptance Criteria**: All RED tests green; installer blocks on missing GPU (W5.2/W5.3 scenarios); first-launch shows specific failure dialog on insufficient VRAM VM; per-generation 503 fires when VRAM <6GB free; `/diagnostics` renders complete report.

  **QA Scenarios**:
  ```
  Scenario: First-launch blocks on insufficient VRAM
    Tool: interactive_bash
    Steps:
      1. Linux VM with NVIDIA GPU 4GB VRAM
      2. Launch app; assert NO main window opens
      3. Assert native error dialog shows "Insufficient VRAM: 4GB detected, 8GB required"
      4. Click Quit; assert app.exit(1) (process gone within 2s)
    Evidence: .sisyphus/evidence/task-W5.4-vram-block.png

  Scenario: Per-generation re-check during contention
    Tool: interactive_bash
    Steps:
      1. macOS arm64 with 8GB unified memory pre-allocated (simulated GPU contention via metal workload)
      2. POST /generate; assert 503 {error:{code:"INSUFFICIENT_VRAM", hint:"Close other GPU apps"}}
    Evidence: .sisyphus/evidence/task-W5.4-runtime-check.txt

  Scenario: Diagnostics page renders full report
    Tool: Playwright
    Steps:
      1. Launch on adequate hardware; nav to /diagnostics
      2. Assert table contains: OS, Arch, GPU model, VRAM GB, RAM GB, Free Disk GB
      3. All rows show green checkmark
      4. Screenshot
    Evidence: .sisyphus/evidence/task-W5.4-diagnostics.png

  Scenario: Threshold boundary (exact 16GB RAM)
    Tool: Bash
    Steps:
      1. Mock sysctl to return 17179869184 (16.0GB exactly)
      2. Call detect(); assert ok=true
      3. Mock to 17179869183 (16.0GB - 1 byte); assert ok=false
    Evidence: .sisyphus/evidence/task-W5.4-threshold.txt

  Scenario: Refuse Intel macOS
    Tool: Bash
    Steps:
      1. Mock sysctl hw.optional.arm64 → 0
      2. Call detect(); assert failures includes {requirement:"arm64", actual:"x86_64"}
    Evidence: .sisyphus/evidence/task-W5.4-intel-refuse.txt
  ```

  **Commit**: YES. `feat(hardware-gate): platform detection + 3-tier enforcement (install/launch/runtime)`. Files: `packages/hardware-gate/src/**`, `packages/hardware-gate/tests/**`, integration in `apps/shell/src/main.ts` + `apps/sidecar/src/routes/generate.py`. Pre-commit: `cd packages/hardware-gate && bun test`.

- [ ] W5.5. Release checklist + version stamping + SHA256 manifests + GitHub Actions matrix

  **What to do**: Create `.github/workflows/release.yml` with matrix `[macos-14, windows-latest, ubuntu-24.04]` triggered on tag `v*`. Each job: checkout (submodules!), setup Bun + Python 3.14 + python-build-standalone, `bun install && bun run build`, platform-specific build script (W5.1/W5.2/W5.3), upload artifacts. Final job aggregates artifacts, generates `SHA256SUMS.txt` via `shasum -a 256`, creates GitHub Release with all installers + checksums attached. Version stamping: `scripts/stamp-version.ts` reads root `package.json` version + propagates to all workspace `package.json` + `apps/sidecar/pyproject.toml` + injects into `apps/renderer/src/version.ts` + `apps/shell/src/version.ts`. Create `RELEASE_CHECKLIST.md` documenting manual steps: bump version, regenerate icons if needed, smoke test on all 3 OS, push tag, monitor GHA, verify checksums match, publish release notes. RED tests: stamp-version writes all files correctly, GHA workflow lints clean via `actionlint`.

  **Must NOT do**: NEVER auto-publish release (require manual "Publish" click in GitHub UI for final review). NEVER include source maps in production builds (renderer build strips them). NEVER skip submodule checkout (heartlib required).

  **Recommended Agent Profile**: `quick`, skills `[]`

  **Parallelization**: YES. Wave 5. Blocked by W5.1, W5.2, W5.3, W5.4 (all installer scripts). Final task before F-wave.

  **References**: External `https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions`, `https://github.com/rhysd/actionlint`. WHY: Reproducible cross-platform releases require CI; SHA256 manifests let users verify unsigned downloads (Linux/unsigned Windows).

  **Acceptance Criteria**: RED tests green; `actionlint .github/workflows/release.yml` clean; dry-run via `act` (or workflow_dispatch on test tag) produces all 3 platform artifacts.

  **QA Scenarios**:
  ```
  Scenario: Version stamp propagates everywhere
    Tool: Bash
    Steps:
      1. Set root package.json version to "0.2.0-test"
      2. Run scripts/stamp-version.ts
      3. grep -r "0.2.0-test" apps/ packages/ — assert ≥6 matches across all workspaces
    Evidence: .sisyphus/evidence/task-W5.5-stamp.txt

  Scenario: GHA workflow lints clean
    Tool: Bash
    Steps:
      1. actionlint .github/workflows/release.yml
      2. Assert exit code 0
    Evidence: .sisyphus/evidence/task-W5.5-actionlint.txt
  ```

  **Commit**: YES. `feat(release): GHA matrix + version stamp + SHA256 manifests`. Files: `.github/workflows/release.yml`, `scripts/stamp-version.ts`, `RELEASE_CHECKLIST.md`, tests. Pre-commit: `bun test release.* && actionlint .github/workflows/release.yml`.

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read this plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found (e.g., grep for `electron-updater`, `console.log`, raw `#[0-9a-f]{6}` in `apps/web/src/`, plaintext `openrouter_key` in SQLite schema). Check all evidence files exist in `.sisyphus/evidence/`. Compare 9 MVP feature deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N violations] | Tasks [N/N evidence] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run typecheck` (frontend + Electron), `ruff check services/backend` + `mypy services/backend`, `bun test` (all), `pytest services/backend` (all). Review all changed files for: `as any`, `@ts-ignore`, `# type: ignore`, empty catches, `console.log`, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (`data`/`result`/`item`/`temp`).
  Output: `TS [PASS/FAIL] | Ruff+Mypy [PASS/FAIL] | bun test [N/N] | pytest [N/N] | Slop [N/N clean] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Build app for macOS arm64. Start from clean state (delete `~/.cache/huggingface/hub/AudioMorph*`, delete app data). Execute EVERY QA scenario from EVERY task using Playwright Electron fixture + screenshot. Critical E2E flow: install → first-run wizard → hardware check → storage path selection → model download (with mock or partial real) → generate 30s song "lo-fi rainy night" → play in waveform+spectrum → export MP3 → favorite → regenerate from library. Test edge cases: cancel mid-generation, OOM simulation, no network, invalid OpenRouter key, special chars in file paths, HiDPI display. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | E2E flow [PASS/FAIL] | Edge cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual `git diff` against base. Verify 1:1 — everything in spec built, nothing beyond spec built. Check "Must NOT do" per-task compliance. Detect cross-task contamination (Task N touching Task M's files). Specifically verify: NO `electron-updater` in `package.json`, NO HF model weights in `extraResources/`, NO analytics SDKs, NO accounts/login routes, NO CPU-only inference code paths, NO raw color literals in `apps/web/src/`.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Forbidden patterns [CLEAN/N found] | VERDICT`

---

## Commit Strategy

Granular per-task commits using Conventional Commits. Groups defined per-task.

- **P0.1-P0.4**: `chore(phase0): verify {area}` — `docs/*.md`, evidence
- **W1.1**: `chore(repo): scaffold bun monorepo` — `package.json`, `tsconfig.json`, `biome.json`, workspace dirs
- **W1.2**: `test(infra): bun test + pytest + playwright electron setup` — test configs, smoke tests
- **W1.3**: `feat(design): OKLCH tokens + Geist + Tailwind config` — `apps/web/src/styles/*`, `tailwind.config.ts`
- **W1.4**: `feat(db): SQLite schema + SQLModel + migrations` — `services/backend/src/db/*`
- **W1.5**: `feat(sidecar): FastAPI bootstrap + ephemeral port + shared secret` — `services/backend/src/app.py`
- **W1.6**: `feat(hw): hardware detection module` — `services/backend/src/hardware/*`
- **W1.7**: `feat(log): structured logger (pino + structlog)` — logger modules
- **W2.x**: `feat(backend): {service name}` — per-service files
- **W3.x**: `feat(web): {page/component}` — per-component files
- **W4.x**: `feat(electron): {area}` — `apps/desktop/src/*`
- **W5.x**: `build({os}): {area}` — `packaging/{os}/*`, `electron-builder.yml`
- Pre-commit hook: `bun run typecheck && bun test --bail && pytest -x services/backend`

---

## Success Criteria

### Verification Commands
```bash
# Repo-level checks
bun run typecheck              # Expected: 0 errors across all workspaces
bun test                       # Expected: all tests pass
pytest services/backend        # Expected: all tests pass
ruff check services/backend    # Expected: 0 issues
mypy services/backend          # Expected: 0 errors

# Build
bun run build:web              # Expected: apps/web/out/ produced
bun run build:desktop          # Expected: dist/mac-arm64/AudioMorph Studio.app

# E2E smoke (Playwright Electron)
bun run test:e2e               # Expected: all E2E scenarios pass + screenshots

# Forbidden-pattern checks (run in F1/F4)
! grep -r "electron-updater" apps/desktop/package.json
! grep -rE "#[0-9a-fA-F]{6}|rgba?\(" apps/web/src/
! grep -r "openrouter_key" services/backend/src/db/
! grep -r "console\.log" apps/web/src/ apps/desktop/src/
```

### Final Checklist
- [ ] All Phase 0 artifacts committed (`docs/heartlib-api-contract.md`, `docs/wheel-matrix-verification.md`, `docs/ffmpeg-source-manifest.md`, `docs/pbs-platform-matrix.md`)
- [ ] All 9 MVP features functional and evidenced
- [ ] 3-platform installers built (macOS arm64 locally; Win/Linux via CI)
- [ ] All "Must Have" present (verified by F1)
- [ ] All "Must NOT Have" absent (verified by F1+F4)
- [ ] All tests pass (F2)
- [ ] E2E flow passes on macOS arm64 (F3)
- [ ] User explicitly approves after seeing F1-F4 results
