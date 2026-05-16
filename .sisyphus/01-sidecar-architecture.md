# Plan: Python 3.14 Sidecar Architecture

## Decision: python-build-standalone over PyInstaller

**Chosen approach:** `astral-sh/python-build-standalone` (PBS)

**Rationale:**

- torch GPU variants (CUDA/MPS/CPU) must be installed at first-run — PBS allows `pip install` into the bundled runtime; PyInstaller cannot
- heartlib and HF deps may require native extensions that PyInstaller hooks miss
- PBS 20260408 release has full Python 3.14 support
- PyInstaller 6.15+ also supports 3.14 but is harder to maintain with 80+ hidden imports for ML stacks

**Fallback:** If PBS bundle size becomes unacceptable (>500MB before torch), revisit PyInstaller `--onedir` with a curated spec file.

---

## Directory Layout (packaged app)

```
resources/
  python/                        ← python-build-standalone runtime
    bin/
      python3.14                 ← macOS/Linux executable
      python3.14.exe             ← Windows executable
    lib/
      python3.14/
        site-packages/           ← pre-installed deps (everything except torch)
  backend/
    main.py                      ← FastAPI entrypoint
    setup/
      first_run.py
      torch_installer.py
    api/
      ...
```

---

## Build Script: stage-backend.cjs

Runs during `electron-builder` `beforeBuild` hook.

```javascript
// scripts/stage-backend.cjs
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PBS_VERSION = '20260408';
const PYTHON_VERSION = '3.14.0';

const PLATFORM_MAP = {
  darwin: {
    arm64: `cpython-${PYTHON_VERSION}+${PBS_VERSION}-aarch64-apple-darwin-install_only.tar.gz`,
    x64: `cpython-${PYTHON_VERSION}+${PBS_VERSION}-x86_64-apple-darwin-install_only.tar.gz`,
  },
  linux: {
    x64: `cpython-${PYTHON_VERSION}+${PBS_VERSION}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
    arm64: `cpython-${PYTHON_VERSION}+${PBS_VERSION}-aarch64-unknown-linux-gnu-install_only.tar.gz`,
  },
  win32: {
    x64: `cpython-${PYTHON_VERSION}+${PBS_VERSION}-x86_64-pc-windows-msvc-install_only.tar.gz`,
  },
};

async function main() {
  const platform = process.platform;
  const arch = process.arch;
  const filename = PLATFORM_MAP[platform]?.[arch];
  if (!filename) throw new Error(`Unsupported platform: ${platform}/${arch}`);

  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_VERSION}/${filename}`;
  const dest = path.join(__dirname, '..', 'resources', 'python');

  if (fs.existsSync(dest)) {
    console.log('Python runtime already staged, skipping download.');
    return;
  }

  console.log(`Downloading PBS: ${filename}`);
  execSync(`curl -L "${url}" | tar -xz -C resources/`, { stdio: 'inherit' });
  fs.renameSync(
    path.join('resources', 'python', `cpython-${PYTHON_VERSION}+${PBS_VERSION}-*`),
    dest,
  );

  // Pre-install everything except torch (torch installed at first-run)
  const pip = path.join(dest, 'bin', platform === 'win32' ? 'pip3.exe' : 'pip3');
  execSync(`"${pip}" install fastapi uvicorn[standard] huggingface_hub hf_xet heartlib`, {
    stdio: 'inherit',
  });

  console.log('Python runtime staged successfully.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

---

## FastAPI Entrypoint

```python
# backend/main.py
import argparse
import sys
import uvicorn
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}

# Import routers
from api import audio, models, setup
app.include_router(audio.router, prefix="/api/audio")
app.include_router(models.router, prefix="/api/models")
app.include_router(setup.router, prefix="/api/setup")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    # Signal Electron that we're ready (stdout sentinel)
    import atexit
    def on_startup():
        print("SIDECAR_READY", flush=True)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="warning",
        callback_notify=on_startup,
    )
```

---

## Electron: Sidecar Lifecycle (electron/sidecar.ts)

```typescript
import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import net from 'net';

let sidecarProcess: ChildProcess | null = null;
let sidecarPort: number | null = null;

function getPythonPath(): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'python')
    : path.join(__dirname, '..', 'resources', 'python');

  return process.platform === 'win32'
    ? path.join(base, 'python.exe')
    : path.join(base, 'bin', 'python3.14');
}

function getBackendPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'main.py')
    : path.join(__dirname, '..', 'backend', 'main.py');
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export async function startSidecar(): Promise<number> {
  const port = await findFreePort();
  const python = getPythonPath();
  const script = getBackendPath();

  sidecarProcess = spawn(python, [script, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Sidecar startup timeout (30s)')), 30_000);

    sidecarProcess!.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('SIDECAR_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    sidecarProcess!.stderr!.on('data', (chunk: Buffer) => {
      console.error('[sidecar]', chunk.toString());
    });

    sidecarProcess!.on('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Sidecar exited unexpectedly: code=${code} signal=${signal}`));
    });
  });

  sidecarPort = port;
  return port;
}

export function stopSidecar(): void {
  if (!sidecarProcess) return;

  if (process.platform === 'win32') {
    // Kill entire process tree on Windows
    spawn('taskkill', ['/pid', String(sidecarProcess.pid), '/f', '/t'], {
      stdio: 'ignore',
    });
  } else {
    sidecarProcess.kill('SIGTERM');
  }

  sidecarProcess = null;
  sidecarPort = null;
}

export function getSidecarPort(): number | null {
  return sidecarPort;
}
```

---

## Security: Bind to 127.0.0.1 Only

The FastAPI sidecar MUST bind to `127.0.0.1`, never `0.0.0.0`. This prevents other processes on the machine from accessing the API. Validate this in the FastAPI startup:

```python
# backend/main.py — add assertion
assert args.host in ('127.0.0.1', 'localhost'), \
    "Sidecar must not bind to external interfaces"
```

---

## Open Questions / Decisions Needed

- [ ] **heartlib**: Confirm it installs cleanly via pip into PBS runtime on all 3 platforms
- [ ] **PBS universal macOS**: PBS ships separate arm64/x64 tarballs. For universal macOS build, stage both and select at runtime, or build two separate app bundles?
- [ ] **Code signing Python runtime**: All `.dylib` and `.so` files in the PBS runtime must be individually signed on macOS. electron-builder handles this if `hardenedRuntime: true` — verify with a test notarization run early.
