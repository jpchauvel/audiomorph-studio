#!/usr/bin/env node
/**
 * Smoke validator for real ML engines. Verifies that:
 *   1. All HuggingFace model snapshots listed in
 *      `apps/sidecar/scripts/required-models.json` are present in the local
 *      HF cache (same check as `ci-hf-cache-verify.mjs`).
 *   2. The Python sidecar can boot in test mode and respond to a
 *      token-authenticated `/health` request.
 *
 * Exit codes:
 *   0  smoke OK
 *   1  expected failure (missing models, sidecar fails health, timeout)
 *   2  unexpected internal error
 *
 * No `shell: true` is used. The sidecar process is always killed on exit.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import process from 'node:process';
import { spawn } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MANIFEST_PATH =
  process.env.AUDIOMORPH_MANIFEST_PATH ||
  path.join(REPO_ROOT, 'apps', 'sidecar', 'scripts', 'required-models.json');
const SIDECAR_DIR = path.join(REPO_ROOT, 'apps', 'sidecar');
const TEST_TOKEN = 'test-token-deterministic-do-not-use-in-prod';
const READY_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 10_000;

let sidecarProc = null;
function killSidecar() {
  if (sidecarProc && !sidecarProc.killed) {
    try {
      sidecarProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}
process.on('exit', killSidecar);
process.on('SIGINT', () => {
  killSidecar();
  process.exit(1);
});
process.on('SIGTERM', () => {
  killSidecar();
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Step 1: HF cache check (mirrors ci-hf-cache-verify.mjs logic).
// ---------------------------------------------------------------------------
function snapshotPath(hfHome, id, revision) {
  const [org, name] = id.split('/');
  if (!org || !name) throw new Error(`invalid model id: ${id}`);
  return path.join(hfHome, 'hub', `models--${org}--${name}`, 'snapshots', revision);
}

async function isDir(p) {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function checkCache() {
  let entries;
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    entries = JSON.parse(raw);
  } catch (err) {
    console.error(`smoke-real-engines: cannot read manifest at ${MANIFEST_PATH}: ${err.message}`);
    return { ok: false };
  }
  if (!Array.isArray(entries)) {
    console.error('smoke-real-engines: manifest must be a JSON array');
    return { ok: false };
  }
  const hfHome = process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface');
  const missing = [];
  for (const e of entries) {
    if (!e?.id || !e?.revision) {
      missing.push(`<malformed entry: ${JSON.stringify(e)}>`);
      continue;
    }
    if (!(await isDir(snapshotPath(hfHome, e.id, e.revision)))) {
      missing.push(`${e.id}@${e.revision}`);
    }
  }
  if (missing.length === 0) {
    console.log(`smoke-real-engines: cache OK (${entries.length} model(s) at ${hfHome})`);
    return { ok: true };
  }
  console.error(
    `smoke-real-engines: MISSING ${missing.length} of ${entries.length} model(s) at ${hfHome}`,
  );
  for (const m of missing) console.error(`  ✗ ${m}`);
  console.error(`\nHint: run \`pnpm test:hf:warm\` to populate the cache.`);
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Step 2-3: Spawn sidecar and wait for ready event on stdout.
// ---------------------------------------------------------------------------
function spawnSidecarAndWaitReady() {
  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON || 'python3';
    sidecarProc = spawn(python, ['-m', 'audiomorph.main', '--port', '0', '--token', TEST_TOKEN], {
      cwd: SIDECAR_DIR,
      env: { ...process.env, AUDIOMORPH_TEST_MODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `sidecar did not emit ready event within ${READY_TIMEOUT_MS}ms; stderr tail: ${stderrBuf.slice(-400)}`,
        ),
      );
    }, READY_TIMEOUT_MS);

    sidecarProc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      let nl;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt && evt.event === 'listening' && typeof evt.port === 'number') {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ port: evt.port });
            return;
          }
        } catch {
          /* non-JSON log line, ignore */
        }
      }
    });

    sidecarProc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
      if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-4000);
    });

    sidecarProc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`failed to spawn sidecar: ${err.message}`));
    });

    sidecarProc.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `sidecar exited before ready (code=${code} signal=${signal}); stderr tail: ${stderrBuf.slice(-400)}`,
        ),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Step 4: Health check.
// ---------------------------------------------------------------------------
async function healthCheck(port) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'POST',
      headers: { 'X-Audiomorph-Token': TEST_TOKEN },
      signal: ctrl.signal,
    });
    return { status: res.status };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------
async function main() {
  const cache = await checkCache();
  if (!cache.ok) return 1;

  let ready;
  try {
    ready = await spawnSidecarAndWaitReady();
  } catch (err) {
    console.error(`smoke-real-engines: ${err.message}`);
    return 1;
  }

  try {
    const { status } = await healthCheck(ready.port);
    if (status === 200) {
      console.log('✅ Sidecar smoke: OK');
      return 0;
    }
    console.error(`smoke-real-engines: /health returned ${status}`);
    return 1;
  } catch (err) {
    console.error(`smoke-real-engines: /health request failed: ${err.message}`);
    return 1;
  } finally {
    killSidecar();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`smoke-real-engines: unexpected error: ${err?.stack ?? err}`);
    killSidecar();
    process.exit(2);
  });
