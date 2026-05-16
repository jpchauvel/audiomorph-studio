/**
 * Shared sidecar spawn helper for integration & e2e tests.
 *
 * Spawns the AudioMorph Python sidecar with deterministic test-mode env,
 * reads stdout-JSON handshake, exposes lifecycle controls. ESM-only.
 *
 * Contract derived from apps/shell/src/sidecar/manager.ts:
 *   - Command: python -m audiomorph.main --port 0 --token <TEST_TOKEN>
 *   - cwd: apps/sidecar/
 *   - First stdout line: {"event":"listening","port":<n>,"token":"<t>"}
 *
 * Test hooks (set via opts.extraEnv):
 *   - AUDIOMORPH_TEST_NO_HANDSHAKE=1 → helper never reads stdout (forces timeout)
 *   - AUDIOMORPH_TEST_TOKEN_OVERRIDE=<str> → helper asserts payload.token === <str>
 *   - AUDIOMORPH_TEST_SPAWN_CMD=<json-array> → override argv (for mock sidecars in tests)
 *   - AUDIOMORPH_TEST_SPAWN_BIN=<path> → override executable
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEST_TOKEN, getTestEnv } from './test-mode.js';

export class SidecarHandshakeTimeout extends Error {
  public constructor(timeoutMs: number) {
    super(`Sidecar handshake timed out after ${timeoutMs}ms`);
    this.name = 'SidecarHandshakeTimeout';
  }
}

export class SidecarHandshakeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SidecarHandshakeError';
  }
}

export interface SpawnSidecarOptions {
  /** Handshake timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Extra env vars merged on top of process.env + getTestEnv(). */
  extraEnv?: Record<string, string>;
  /** Working directory for spawn; defaults to <repoRoot>/apps/sidecar. */
  cwd?: string;
}

export interface SidecarHandle {
  proc: ChildProcess;
  port: number;
  token: string;
  baseUrl: string;
  kill: () => Promise<void>;
}

interface HandshakePayload {
  event: string;
  port: number;
  token: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SIGKILL_GRACE_MS = 5_000;

function resolveRepoRoot(): string {
  // packages/test-helpers/src/sidecar.ts → repo root is 3 levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..');
}

function resolvePythonPath(): string {
  const repoRoot = resolveRepoRoot();
  const venvPython = path.join(repoRoot, '.venv', 'bin', 'python');
  return venvPython;
}

/**
 * Spawn a sidecar process and wait for its stdout-JSON handshake.
 *
 * On timeout or invalid handshake, the child is forcibly killed before
 * the returned promise rejects.
 */
export async function spawnSidecar(opts: SpawnSidecarOptions = {}): Promise<SidecarHandle> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const repoRoot = resolveRepoRoot();
  const cwd = opts.cwd ?? path.join(repoRoot, 'apps', 'sidecar');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...getTestEnv(),
    ...(opts.extraEnv ?? {}),
  };

  // Allow test-only override of spawn command (for mock sidecars in unit tests).
  const overrideBin = env.AUDIOMORPH_TEST_SPAWN_BIN;
  const overrideCmdRaw = env.AUDIOMORPH_TEST_SPAWN_CMD;

  let bin: string;
  let args: string[];
  if (overrideBin && overrideCmdRaw) {
    bin = overrideBin;
    try {
      const parsed: unknown = JSON.parse(overrideCmdRaw);
      if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === 'string')) {
        throw new Error('AUDIOMORPH_TEST_SPAWN_CMD must be JSON string array');
      }
      args = parsed as string[];
    } catch (e) {
      throw new SidecarHandshakeError(`Invalid AUDIOMORPH_TEST_SPAWN_CMD: ${(e as Error).message}`);
    }
  } else {
    bin = resolvePythonPath();
    args = ['-m', 'audiomorph.main', '--port', '0', '--token', TEST_TOKEN];
  }

  const proc = spawn(bin, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Always pass stderr through to caller's stderr (no console.log).
  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
  }

  const noHandshake = env.AUDIOMORPH_TEST_NO_HANDSHAKE === '1';
  const expectedToken = env.AUDIOMORPH_TEST_TOKEN_OVERRIDE ?? TEST_TOKEN;

  const killProc = async (): Promise<void> => {
    await killChild(proc);
  };

  try {
    const payload = await readHandshake(proc, timeoutMs, noHandshake);

    if (payload.event !== 'listening') {
      throw new SidecarHandshakeError(
        `Handshake event must be "listening", got "${payload.event}"`,
      );
    }
    if (typeof payload.port !== 'number' || !Number.isFinite(payload.port)) {
      throw new SidecarHandshakeError(
        `Handshake port must be a finite number, got ${String(payload.port)}`,
      );
    }
    if (typeof payload.token !== 'string' || payload.token.length === 0) {
      throw new SidecarHandshakeError('Handshake token must be non-empty string');
    }
    if (payload.token !== expectedToken) {
      throw new SidecarHandshakeError(
        `Handshake token mismatch (expected match, got different value)`,
      );
    }

    return {
      proc,
      port: payload.port,
      token: payload.token,
      baseUrl: `http://127.0.0.1:${payload.port}`,
      kill: killProc,
    };
  } catch (err) {
    await killProc();
    throw err;
  }
}

function readHandshake(
  proc: ChildProcess,
  timeoutMs: number,
  noHandshake: boolean,
): Promise<HandshakePayload> {
  return new Promise<HandshakePayload>((resolve, reject) => {
    const stdout = proc.stdout;
    if (!stdout) {
      reject(new SidecarHandshakeError('Sidecar stdout pipe not available'));
      return;
    }

    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        rl.close();
      } catch {
        // ignore
      }
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new SidecarHandshakeTimeout(timeoutMs)));
    }, timeoutMs);

    const rl = createInterface({ input: stdout });

    if (noHandshake) {
      // Test hook: do not consume stdout; force timeout path.
      return;
    }

    rl.once('line', (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        settle(() => reject(new SidecarHandshakeError('Handshake line is not valid JSON')));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        settle(() => reject(new SidecarHandshakeError('Handshake payload must be object')));
        return;
      }
      settle(() => resolve(parsed as HandshakePayload));
    });

    proc.once('error', (err) => {
      settle(() =>
        reject(new SidecarHandshakeError(`Sidecar process error: ${(err as Error).message}`)),
      );
    });

    proc.once('exit', (code) => {
      settle(() =>
        reject(new SidecarHandshakeError(`Sidecar exited before handshake (code=${String(code)})`)),
      );
    });
  });
}

async function killChild(proc: ChildProcess): Promise<void> {
  if (proc.exitCode != null || proc.signalCode != null) {
    return;
  }
  if (typeof proc.pid !== 'number') {
    return;
  }

  const exited = waitForExit(proc, SIGKILL_GRACE_MS);
  try {
    proc.kill('SIGTERM');
  } catch {
    // ignore
  }

  const cleanly = await exited;
  if (!cleanly && proc.exitCode == null && proc.signalCode == null) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
    await waitForExit(proc, 1_000);
  }
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (proc.exitCode != null || proc.signalCode != null) {
      resolve(true);
      return;
    }
    let done = false;
    const finish = (val: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      proc.off('exit', onExit);
      resolve(val);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    proc.once('exit', onExit);
  });
}

/**
 * Poll GET ${baseUrl}/health every 200ms with X-Audiomorph-Token until 2xx
 * or until timeoutMs elapses.
 */
export async function waitForSidecarReady(
  baseUrl: string,
  token: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const intervalMs = 200;

  while (Date.now() < deadline) {
    const ok = await probeHealth(baseUrl, token);
    if (ok) return;
    await sleep(intervalMs);
  }

  throw new SidecarHandshakeTimeout(timeoutMs);
}

function probeHealth(baseUrl: string, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL('/health', baseUrl);
    } catch {
      resolve(false);
      return;
    }
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 80,
        path: url.pathname,
        method: 'GET',
        headers: { 'X-Audiomorph-Token': token },
        timeout: 1_500,
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        resolve(status >= 200 && status < 300);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
