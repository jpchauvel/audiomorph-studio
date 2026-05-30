#!/usr/bin/env node
// Vendors a standalone CPython 3.12 + sidecar deps into
// apps/shell/build/python/<platform>-<arch>/ so electron-builder can ship it as
// extraResources. Runtime path resolution lives in
// apps/shell/src/sidecar/manager.ts (resolvePythonPath).
//
// Host-only: this script bundles for the CURRENT host platform/arch. Cross-OS
// dist builds are not supported here; run dist:{mac,win,linux} on the matching
// host.
//
// Pinned to a python-build-standalone release that ships CPython 3.12.x
// "install_only" tarballs. Bump PBS_RELEASE + PBS_PYTHON together.

import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, chmod, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PBS_RELEASE = '20250115';
const PBS_PYTHON = '3.12.8';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(REPO_ROOT, 'apps', 'shell', 'build', 'python');

const TRIPLES = {
  'macos-arm64': 'aarch64-apple-darwin',
  'macos-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'windows-x64': 'x86_64-pc-windows-msvc-shared',
};

// Matches PLATFORM_MAP in apps/shell/src/sidecar/manager.ts:
// runtime expects bundles at resourcesPath/python/<this-key>/.
function targetKey() {
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch;
  if (process.platform === 'darwin') return `macos-${arch}`;
  if (process.platform === 'win32') return `windows-${arch}`;
  if (process.platform === 'linux') return `linux-${arch}`;
  return `${process.platform}-${arch}`;
}

function tarballUrl(triple) {
  return (
    `https://github.com/astral-sh/python-build-standalone/releases/download/` +
    `${PBS_RELEASE}/cpython-${PBS_PYTHON}+${PBS_RELEASE}-${triple}-install_only.tar.gz`
  );
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function download(url, dest) {
  console.log(`[bundle-python] GET ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const hash = createHash('sha256');
  const file = createWriteStream(dest);
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    file.write(value);
  }
  await new Promise((resolve, reject) => {
    file.end((err) => (err ? reject(err) : resolve()));
  });
  console.log(`[bundle-python] sha256=${hash.digest('hex')}  →  ${dest}`);
}

async function extractTarGz(tarball, outDir) {
  await mkdir(outDir, { recursive: true });
  // python-build-standalone install_only tarballs contain a top-level
  // `python/` directory; strip it so we land directly in <outDir>.
  await run('tar', ['-xzf', tarball, '-C', outDir, '--strip-components=1']);
}

function pythonBin(rootDir) {
  return process.platform === 'win32'
    ? path.join(rootDir, 'python.exe')
    : path.join(rootDir, 'bin', 'python3');
}

async function ensurePip(py) {
  await run(py, ['-m', 'ensurepip', '--upgrade']);
  await run(py, ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel', 'setuptools']);
}

async function installSidecar(py) {
  const sidecar = path.join(REPO_ROOT, 'apps', 'sidecar');
  const heartlib = path.join(REPO_ROOT, 'heartlib');
  // heartlib is a vendored submodule consumed editable by the sidecar.
  if (await exists(path.join(heartlib, 'pyproject.toml'))) {
    await run(py, ['-m', 'pip', 'install', '--no-cache-dir', '-e', heartlib]);
  } else {
    console.warn('[bundle-python] heartlib/ has no pyproject.toml — skipping (submodule not initialised?)');
  }
  await run(py, ['-m', 'pip', 'install', '--no-cache-dir', '-e', sidecar]);
}

async function main() {
  const key = targetKey();
  const triple = TRIPLES[key];
  if (!triple) {
    console.error(`[bundle-python] Unsupported host target: ${key}`);
    console.error(`[bundle-python] Supported: ${Object.keys(TRIPLES).join(', ')}`);
    process.exit(1);
  }

  const outDir = path.join(OUT_ROOT, key);
  if (await exists(outDir) && !process.env.BUNDLE_PYTHON_FORCE) {
    const py = pythonBin(outDir);
    if (await exists(py)) {
      console.log(`[bundle-python] Reusing existing bundle at ${outDir} (set BUNDLE_PYTHON_FORCE=1 to rebuild)`);
      return;
    }
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(OUT_ROOT, { recursive: true });

  const tarball = path.join(OUT_ROOT, `cpython-${PBS_PYTHON}-${triple}.tar.gz`);
  if (!(await exists(tarball)) || process.env.BUNDLE_PYTHON_FORCE) {
    await download(tarballUrl(triple), tarball);
  }
  await extractTarGz(tarball, outDir);

  const py = pythonBin(outDir);
  if (!(await exists(py))) {
    throw new Error(`Expected interpreter not found after extract: ${py}`);
  }
  if (process.platform !== 'win32') {
    await chmod(py, 0o755);
  }

  await ensurePip(py);
  await installSidecar(py);

  console.log(`[bundle-python] Done: ${outDir}`);
  console.log(`[bundle-python] Interpreter: ${py}`);
  const top = await readdir(outDir);
  console.log(`[bundle-python] Layout: ${top.join(', ')}`);
}

main().catch((err) => {
  console.error(`[bundle-python] FAILED: ${err.message}`);
  process.exit(1);
});
