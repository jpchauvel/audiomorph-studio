import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';

import {
  launchElectronApp,
  resolveRepoRoot,
  resolveElectronBin,
  resolveShellMain,
  ElectronLaunchError,
  type ElectronLauncher,
  type ElectronApplicationLike,
} from './electron.js';
import { TEST_MODE_ENV, TEST_TOKEN } from './test-mode.js';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
}

function makeFakeLauncher(
  evaluateImpl: (fn: (electron: unknown) => unknown) => Promise<unknown>,
  closeSpy: () => Promise<void>,
  capture?: { lastOpts?: Parameters<ElectronLauncher['launch']>[0] },
): ElectronLauncher {
  return {
    async launch(opts) {
      if (capture) capture.lastOpts = opts;
      const app: ElectronApplicationLike = {
        async firstWindow() {
          return { async close() {} };
        },
        async evaluate(fn) {
          return (await evaluateImpl(fn as never)) as never;
        },
        close: closeSpy,
      };
      return app;
    },
  };
}

describe('resolveRepoRoot', () => {
  it('locates pnpm-workspace.yaml', () => {
    const root = resolveRepoRoot();
    expect(fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('throws when not found', () => {
    expect(() => resolveRepoRoot(os.tmpdir())).toThrow(ElectronLaunchError);
  });
});

describe('resolveElectronBin', () => {
  afterEach(restoreEnv);

  it('honors AUDIOMORPH_TEST_ELECTRON_BIN override', () => {
    process.env.AUDIOMORPH_TEST_ELECTRON_BIN = '/custom/electron';
    expect(resolveElectronBin()).toBe('/custom/electron');
  });

  it('throws when no candidate exists', () => {
    delete process.env.AUDIOMORPH_TEST_ELECTRON_BIN;
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fakeroot-'));
    fs.writeFileSync(path.join(fakeRoot, 'pnpm-workspace.yaml'), '');
    expect(() => resolveElectronBin(fakeRoot)).toThrow(/Electron binary not found/);
  });
});

describe('resolveShellMain', () => {
  afterEach(restoreEnv);

  it('honors AUDIOMORPH_TEST_ELECTRON_MAIN override', () => {
    process.env.AUDIOMORPH_TEST_ELECTRON_MAIN = '/custom/main.js';
    expect(resolveShellMain()).toBe('/custom/main.js');
  });

  it('throws when no built main exists', () => {
    delete process.env.AUDIOMORPH_TEST_ELECTRON_MAIN;
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fakeroot-'));
    fs.writeFileSync(path.join(fakeRoot, 'pnpm-workspace.yaml'), '');
    expect(() => resolveShellMain(fakeRoot)).toThrow(/Shell main\.js not found/);
  });
});

describe('launchElectronApp', () => {
  let tmpRoot: string;
  let electronBin: string;
  let shellMain: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-test-'));
    electronBin = path.join(tmpRoot, 'fake-electron');
    shellMain = path.join(tmpRoot, 'fake-main.js');
    fs.writeFileSync(electronBin, '#!/bin/sh\n');
    fs.writeFileSync(shellMain, '');
  });

  afterEach(() => {
    restoreEnv();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns handle with sidecar port + token, cleans up on close', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const closeSpy = vi.fn(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const capture: { lastOpts?: Parameters<ElectronLauncher['launch']>[0] } = {};
    const launcher = makeFakeLauncher(
      async () => ({ port, token: 'tkn' }),
      closeSpy,
      capture,
    );

    const handle = await launchElectronApp(
      { electronBin, shellMain, extraEnv: { FOO: 'bar' } },
      launcher,
    );

    expect(handle.sidecarPort).toBe(port);
    expect(handle.sidecarToken).toBe('tkn');
    expect(capture.lastOpts?.executablePath).toBe(electronBin);
    expect(capture.lastOpts?.args).toEqual([shellMain]);
    expect(capture.lastOpts?.env?.[TEST_MODE_ENV]).toBe('1');
    expect(capture.lastOpts?.env?.FOO).toBe('bar');

    await handle.close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('closes app and throws on invalid port', async () => {
    const closeSpy = vi.fn(async () => {});
    const launcher = makeFakeLauncher(
      async () => ({ port: 'not-a-number', token: 'tkn' }),
      closeSpy,
    );
    await expect(
      launchElectronApp({ electronBin, shellMain }, launcher),
    ).rejects.toThrow(/Invalid sidecar port/);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('closes app and throws on missing token', async () => {
    const closeSpy = vi.fn(async () => {});
    const launcher = makeFakeLauncher(
      async () => ({ port: 1234, token: '' }),
      closeSpy,
    );
    await expect(
      launchElectronApp({ electronBin, shellMain }, launcher),
    ).rejects.toThrow(/Invalid sidecar token/);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('propagates evaluate error and closes app', async () => {
    const closeSpy = vi.fn(async () => {});
    const launcher = makeFakeLauncher(async () => {
      throw new Error('handler not registered');
    }, closeSpy);
    await expect(
      launchElectronApp({ electronBin, shellMain }, launcher),
    ).rejects.toThrow(/handler not registered/);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('close() throws if sidecar remains reachable past timeout', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const closeSpy = vi.fn(async () => {});
    const launcher = makeFakeLauncher(
      async () => ({ port, token: 'tkn' }),
      closeSpy,
    );

    const handle = await launchElectronApp(
      { electronBin, shellMain, cleanupTimeoutMs: 300 },
      launcher,
    );
    await expect(handle.close()).rejects.toThrow(/still reachable/);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('TEST_TOKEN constant matches contract', () => {
    expect(TEST_TOKEN).toBe('test-token-deterministic-do-not-use-in-prod');
  });
});
