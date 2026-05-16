# Plan: First-Run Setup Wizard

## Overview

The first-run wizard handles everything that cannot be bundled:
1. Detect GPU hardware (NVIDIA CUDA / Apple MPS / CPU-only)
2. Install the correct PyTorch variant into the bundled PBS Python runtime
3. Verify heartlib and other ML deps are functional
4. Optionally pre-download a default model

This runs **before** the main app window opens, in a dedicated setup window.

---

## State File

```typescript
// electron/setup-state.ts
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

const SETUP_MARKER = path.join(app.getPath('userData'), 'setup_complete.json')

export interface SetupState {
  version: number          // bump when setup needs to re-run
  torchVariant: 'cuda' | 'mps' | 'cpu'
  cudaVersion?: string
  completedAt: string
}

export const CURRENT_SETUP_VERSION = 1

export function isFirstRun(): boolean {
  if (!fs.existsSync(SETUP_MARKER)) return true
  try {
    const state: SetupState = JSON.parse(fs.readFileSync(SETUP_MARKER, 'utf8'))
    return state.version < CURRENT_SETUP_VERSION
  } catch { return true }
}

export function markSetupComplete(state: Omit<SetupState, 'completedAt'>): void {
  fs.writeFileSync(SETUP_MARKER, JSON.stringify({
    ...state, completedAt: new Date().toISOString(),
  }, null, 2))
}
```

---

## Python: Hardware Detection

```python
# backend/setup/detect_hardware.py
import subprocess, platform
from dataclasses import dataclass
from typing import Literal

@dataclass
class HardwareInfo:
    torch_variant: Literal['cuda', 'mps', 'cpu']
    cuda_version: str | None
    gpu_name: str | None

def detect_hardware() -> HardwareInfo:
    plat = platform.system()

    if plat == 'Darwin':
        r = subprocess.run(['sysctl', '-n', 'hw.optional.arm64'],
                           capture_output=True, text=True)
        is_apple_silicon = r.stdout.strip() == '1'
        return HardwareInfo(
            torch_variant='mps' if is_apple_silicon else 'cpu',
            cuda_version=None,
            gpu_name='Apple Silicon GPU' if is_apple_silicon else None,
        )

    try:
        r = subprocess.run(
            ['nvidia-smi', '--query-gpu=name,driver_version', '--format=csv,noheader'],
            capture_output=True, text=True, timeout=10
        )
        if r.returncode == 0:
            gpu_name, driver = r.stdout.strip().split(',', 1)
            major = int(driver.strip().split('.')[0])
            cuda_ver = 'cu128' if major >= 525 else ('cu118' if major >= 450 else None)
            if cuda_ver:
                return HardwareInfo('cuda', cuda_ver, gpu_name.strip())
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return HardwareInfo('cpu', None, None)
```

---

## Python: Torch Installer with SSE Progress

```python
# backend/api/setup.py
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from ..setup.detect_hardware import detect_hardware
import subprocess, sys, json, asyncio

router = APIRouter()

TORCH_INDEX_URLS = {
    'cu128': 'https://download.pytorch.org/whl/cu128',
    'cu118': 'https://download.pytorch.org/whl/cu118',
    'cpu':   'https://download.pytorch.org/whl/cpu',
}

@router.get("/hardware")
async def get_hardware():
    hw = detect_hardware()
    return {"torchVariant": hw.torch_variant, "cudaVersion": hw.cuda_version,
            "gpuName": hw.gpu_name}

@router.post("/install-torch")
async def install_torch_sse():
    hw = detect_hardware()
    index_url = TORCH_INDEX_URLS.get(hw.cuda_version or 'cpu') if hw.torch_variant != 'mps' else None

    async def stream():
        cmd = [sys.executable, '-m', 'pip', 'install', 'torch', 'torchvision', 'torchaudio']
        if index_url:
            cmd += ['--index-url', index_url]

        yield f'data: {json.dumps({"stage":"installing","message":"Starting pip install...","percent":5})}\n\n'

        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        async for line in proc.stdout:
            msg = line.decode().strip()
            if msg:
                yield f'data: {json.dumps({"stage":"installing","message":msg,"percent":None})}\n\n'

        await proc.wait()
        if proc.returncode == 0:
            yield f'data: {json.dumps({"stage":"complete","message":"PyTorch installed.","percent":100})}\n\n'
        else:
            yield f'data: {json.dumps({"stage":"error","message":"pip install failed","percent":None})}\n\n'

    return StreamingResponse(stream(), media_type="text/event-stream")
```

---

## Flow Diagram

```
App launch
    │
    ▼
isFirstRun()?
    │ YES
    ▼
Open setup window (560×480, frameless)
    │
    ▼
GET /api/setup/hardware
    │
    ▼
Show: "Detected: NVIDIA RTX 4090 (CUDA 12.8)"
      [Install Now] button
    │
    ▼
POST /api/setup/install-torch  (SSE stream)
    ├── "Downloading torch+cu128..."
    └── "PyTorch installed successfully."
    │
    ▼
Write setup_complete.json → close setup window → open main window
```

---

## Open Questions / Decisions Needed

- [ ] **Re-run setup**: Allow users to re-run from Settings (e.g., after adding a GPU)?
- [ ] **Offline install**: Show clear error + manual install instructions if no internet?
- [ ] **heartlib smoke test**: Run `import heartlib; heartlib.verify()` after torch install?
- [ ] **Default model**: Offer to pre-download a small default model during setup?
