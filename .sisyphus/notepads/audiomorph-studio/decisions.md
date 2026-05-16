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

## [2026-05-16] Python Version Decision (P0.2 finding)

- DECISION: Pin sidecar to Python 3.12 (NOT 3.14)
- REASON: 9/14 heartlib deps have zero cp314 wheels on PyPI (bitsandbytes, transformers, huggingface_hub, soundfile, torchtune, torchao, accelerate, modelscope, vector-quantize-pytorch)
- ACTION: W1.1 must use requires-python = ">=3.12,<3.13" in apps/sidecar/pyproject.toml
- PBS: Use cpython-3.12.x builds from astral-sh/python-build-standalone
- NOTE: torch/torchcodec/torchaudio/torchvision/numpy all have cp312 wheels — no functional loss
