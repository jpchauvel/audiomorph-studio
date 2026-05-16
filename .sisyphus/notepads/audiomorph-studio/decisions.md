## [2026-05-16] Session Init
- Monorepo: pnpm workspaces
- Python bundling: python-build-standalone (PBS) by astral-sh
- UI: "Dark Precision" — OKLCH tokens, Geist font, shadcn/ui + Magic UI
- Player: wavesurfer.js v7 + Canvas FFT side-by-side
- Key storage: Electron safeStorage/keytar (NOT localStorage)
- Sidecar: ephemeral port + shared-secret header
- No GPU → installer refuses to install

## [2026-05-16] P0.4 mmgp integration decision
- Decision: skip vendoring/integrating mmgp in adapter phase.
- Rationale: no mmgp import/dependency in heartlib source or pyproject; memory lifecycle already handled with lazy loading + unload + gc + cuda cache clear.
