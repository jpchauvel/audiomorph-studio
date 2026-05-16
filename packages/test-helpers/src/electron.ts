/**
 * Electron launch helper for integration & e2e tests.
 *
 * Launches the AudioMorph shell under Playwright's Electron driver with
 * deterministic test-mode env, waits for first window, and extracts sidecar
 * (port, token) via the test-only IPC channel `__audiomorph_test:get-sidecar-info`.
 * ESM-only.
 *
 * Test hooks (set via opts.extraEnv):
 *   - AUDIOMORPH_TEST_ELECTRON_BIN=<path>       override Electron executable
 *   - AUDIOMORPH_TEST_ELECTRON_MAIN=<path>      override shell main.js entry
 *   - AUDIOMORPH_TEST_ELECTRON_LAUNCHER=<json>  injected launcher (tests only)
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTestEnv, TEST_TOKEN } from './test-mode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _SIDECAR_INFO_CHANNEL = '__audiomorph_test:get-sidecar-info';
const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;
const SIDECAR_CLEANUP_TIMEOUT_MS = 10_000;
const SIDECAR_POLL_INTERVAL_MS = 200;

export class ElectronLaunchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ElectronLaunchError';
  }
}

export interface LaunchElectronOptions {
  args?: string[];
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
  electronBin?: string;
  shellMain?: string;
  cleanupTimeoutMs?: number;
}

export interface ElectronLaunchHandle {
  app: ElectronApplicationLike;
  firstWindow: PageLike;
  sidecarPort: number;
  sidecarToken: string;
  close: () => Promise<void>;
}

export interface PageLike {
  close?: () => Promise<void> | void;
}

export interface ElectronApplicationLike {
  firstWindow: () => Promise<PageLike>;
  evaluate: <T>(fn: (electron: ElectronEvaluateArg) => Promise<T> | T) => Promise<T>;
  close: () => Promise<void>;
}

export interface ElectronEvaluateArg {
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => void };
}

export interface ElectronLauncher {
  launch: (opts: {
    executablePath: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    timeout: number;
  }) => Promise<ElectronApplicationLike>;
}

interface SidecarInfo {
  port: number;
  token: string;
}

/**
 * Resolve workspace root by walking up from this file.
 */
export function resolveRepoRoot(startDir: string = __dirname): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ElectronLaunchError(`Could not locate pnpm-workspace.yaml from ${startDir}`);
}

/**
 * Resolve Electron binary path: env override, then platform-specific defaults.
 */
export function resolveElectronBin(repoRoot: string = resolveRepoRoot()): string {
  const override = process.env.AUDIOMORPH_TEST_ELECTRON_BIN;
  if (override) {
    return override;
  }

  const shellNodeModules = path.join(repoRoot, 'apps', 'shell', 'node_modules');
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    candidates.push(
      path.join(
        shellNodeModules,
        'electron',
        'dist',
        'Electron.app',
        'Contents',
        'MacOS',
        'Electron',
      ),
    );
  } else if (process.platform === 'win32') {
    candidates.push(path.join(shellNodeModules, 'electron', 'dist', 'electron.exe'));
  } else {
    candidates.push(path.join(shellNodeModules, 'electron', 'dist', 'electron'));
  }
  candidates.push(path.join(shellNodeModules, '.bin', 'electron'));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new ElectronLaunchError(`Electron binary not found. Searched: ${candidates.join(', ')}`);
}

/**
 * Resolve shell main.js entry: env override, then built output.
 */
export function resolveShellMain(repoRoot: string = resolveRepoRoot()): string {
  const override = process.env.AUDIOMORPH_TEST_ELECTRON_MAIN;
  if (override) {
    return override;
  }
  const candidates = [
    path.join(repoRoot, 'apps', 'shell', 'out', 'main', 'main.js'),
    path.join(repoRoot, 'apps', 'shell', 'dist', 'main.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new ElectronLaunchError(`Shell main.js not found. Searched: ${candidates.join(', ')}`);
}

async function loadDefaultLauncher(): Promise<ElectronLauncher> {
  const injected = process.env.AUDIOMORPH_TEST_ELECTRON_LAUNCHER;
  if (injected) {
    const parsed = JSON.parse(injected) as { module: string; export?: string };
    const mod = (await import(parsed.module)) as Record<string, unknown>;
    const exportName = parsed.export ?? 'default';
    const candidate = mod[exportName];
    if (!candidate || typeof (candidate as ElectronLauncher).launch !== 'function') {
      throw new ElectronLaunchError(
        `Injected launcher ${parsed.module}#${exportName} has no .launch()`,
      );
    }
    return candidate as ElectronLauncher;
  }
  const playwright = (await import('@playwright/test')) as {
    _electron?: ElectronLauncher;
  };
  if (!playwright._electron) {
    throw new ElectronLaunchError(
      '@playwright/test does not expose _electron — install @playwright/test ^1.48',
    );
  }
  return playwright._electron;
}

async function pollSidecarUnreachable(port: number, timeoutMs: number): Promise<boolean> {
  const http = await import('node:http');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/healthz',
          method: 'GET',
          timeout: 500,
        },
        (res) => {
          res.resume();
          resolve(true);
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    });
    if (!reachable) return true;
    await new Promise((r) => setTimeout(r, SIDECAR_POLL_INTERVAL_MS));
  }
  return false;
}

/**
 * Launch Electron shell with test-mode env, return handle exposing sidecar info.
 *
 * Caller must invoke handle.close() to release Electron + sidecar.
 */
export async function launchElectronApp(
  opts: LaunchElectronOptions = {},
  launcherOverride?: ElectronLauncher,
): Promise<ElectronLaunchHandle> {
  const launcher = launcherOverride ?? (await loadDefaultLauncher());
  const repoRoot = resolveRepoRoot();
  const electronBin = opts.electronBin ?? resolveElectronBin(repoRoot);
  const shellMain = opts.shellMain ?? resolveShellMain(repoRoot);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...getTestEnv(),
    ...(opts.extraEnv ?? {}),
  };

  const app = await launcher.launch({
    executablePath: electronBin,
    args: [shellMain, ...(opts.args ?? [])],
    env,
    timeout: opts.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS,
  });

  let firstWindow: PageLike;
  let sidecarInfo: SidecarInfo;
  try {
    firstWindow = await app.firstWindow();
    sidecarInfo = await app.evaluate<SidecarInfo>(async (electron) => {
      const ipcMain = (
        electron as unknown as {
          ipcMain: { listeners: (ch: string) => Array<(...a: unknown[]) => unknown> };
        }
      ).ipcMain;
      const listeners = ipcMain.listeners('__audiomorph_test:get-sidecar-info');
      if (listeners.length === 0) {
        throw new Error('test-mode IPC handler not registered (AUDIOMORPH_TEST_MODE=1 required)');
      }
      const result = await Promise.resolve(listeners[0]!({} as never));
      return result as SidecarInfo;
    });
  } catch (err) {
    await app.close().catch(() => {});
    throw err instanceof Error
      ? err
      : new ElectronLaunchError(`Electron launch failed: ${String(err)}`);
  }

  if (typeof sidecarInfo.port !== 'number' || !Number.isFinite(sidecarInfo.port)) {
    await app.close().catch(() => {});
    throw new ElectronLaunchError(
      `Invalid sidecar port from test IPC: ${String(sidecarInfo.port)}`,
    );
  }
  if (typeof sidecarInfo.token !== 'string' || sidecarInfo.token.length === 0) {
    await app.close().catch(() => {});
    throw new ElectronLaunchError('Invalid sidecar token from test IPC');
  }

  const cleanupTimeoutMs = opts.cleanupTimeoutMs ?? SIDECAR_CLEANUP_TIMEOUT_MS;
  const close = async (): Promise<void> => {
    const port = sidecarInfo.port;
    await app.close().catch(() => {});
    const reaped = await pollSidecarUnreachable(port, cleanupTimeoutMs);
    if (!reaped) {
      throw new ElectronLaunchError(
        `Sidecar still reachable on port ${port} after ${cleanupTimeoutMs}ms`,
      );
    }
  };

  return {
    app,
    firstWindow,
    sidecarPort: sidecarInfo.port,
    sidecarToken: sidecarInfo.token,
    close,
  };
}

export const __TEST_TOKEN_CONSTANT = TEST_TOKEN;
export const __OS_TMPDIR_FOR_TESTS = os.tmpdir;
