# Decisions — testing-integration-e2e

## [2026-05-16] Session ses_1cef35312ffeupqA90Up40ilE2 — Init
- Six test layers: Component / Renderer Integration / Sidecar pytest Integration / Electron E2E / Visual Regression / CI Pipeline
- CI Tiering: PR (Linux smoke <15min) / Main (Linux + visual <30min) / Nightly (3-platform + real engines <90min)
- HF models: musicgen-small (~2GB) + whisper-tiny (~75MB) pinned to revision SHAs
- Visual baselines: per-OS dirs __snapshots__/{darwin,win32,linux}/; manual update via workflow_dispatch only
- OpenRouter: always mocked in CI via local HTTP stub
- Test sentinel: AUDIOMORPH_TEST_MODE=1 → memory vault, fixed TEST_TOKEN, deterministic IDs, no telemetry
- Shared packages/test-helpers/ workspace package as single source of truth
- macOS jobs nightly-only (10x cost multiplier)
- Fork guard on schedule trigger (prevents fork-billed runs)
- Concurrency: cancel-in-progress=true on PR tier, false on main/nightly
- Default permissions: contents:read at workflow level
