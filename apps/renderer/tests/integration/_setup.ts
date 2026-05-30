import { test as base } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawnSidecar, type SidecarHandle } from '@audiomorph/test-helpers/sidecar';
import { TEST_TOKEN } from '@audiomorph/test-helpers/test-mode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const RENDERER_OUT = path.resolve(__dirname, '../../out');
const VENV_PYTHON = path.join(REPO_ROOT, '.venv', 'bin', 'python');

export const RENDERER_BUILD_PRESENT = fs.existsSync(path.join(RENDERER_OUT, 'index.html'));
export const SIDECAR_RUNTIME_PRESENT = fs.existsSync(VENV_PYTHON);
export const RENDERER_OUT_DIR = RENDERER_OUT;
export const REPOSITORY_ROOT = REPO_ROOT;

export interface StaticServerHandle {
  url: string;
  port: number;
  kill: () => Promise<void>;
}

export async function startStaticServer(rootDir: string): Promise<StaticServerHandle> {
  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'pnpm', args: ['dlx', 'serve@latest', rootDir, '-l', '0', '--no-clipboard'] },
    { cmd: 'npx', args: ['--yes', 'serve', rootDir, '-l', '0', '--no-clipboard'] },
  ];

  let lastErr: Error | undefined;
  for (const candidate of candidates) {
    try {
      return await launchServer(candidate.cmd, candidate.args);
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new Error(
    `Failed to start static server (tried pnpm dlx, npx): ${lastErr?.message ?? 'unknown'}`,
  );
}

function launchServer(cmd: string, args: string[]): Promise<StaticServerHandle> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    let stdoutBuf = '';
    let stderrBuf = '';
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGKILL');
        reject(new Error(`Static server start timeout. stdout=${stdoutBuf} stderr=${stderrBuf}`));
      }
    }, 15_000);

    const tryResolve = (text: string) => {
      if (resolved) return;
      const m = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)/);
      if (m) {
        resolved = true;
        clearTimeout(timeout);
        const port = Number.parseInt(m[1]!, 10);
        const url = `http://127.0.0.1:${port}`;
        resolve({
          url,
          port,
          kill: async () => {
            if (!proc.killed && proc.pid) {
              proc.kill('SIGTERM');
              await new Promise((r) => setTimeout(r, 200));
              if (!proc.killed) proc.kill('SIGKILL');
            }
          },
        });
      }
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      tryResolve(stdoutBuf);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      tryResolve(stderrBuf);
    });
    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(
          new Error(`Static server exited with code ${code} before listening. stderr=${stderrBuf}`),
        );
      }
    });
  });
}

export interface OpenRouterStubHandle {
  url: string;
  port: number;
  requests: Array<{ method: string; url: string; headers: Record<string, string>; body: string }>;
  kill: () => Promise<void>;
}

export function startOpenRouterStub(fixtureBody: string): Promise<OpenRouterStubHandle> {
  return new Promise((resolve, reject) => {
    const requests: OpenRouterStubHandle['requests'] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(fixtureBody);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('OpenRouter stub failed to bind'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        requests,
        kill: async () => {
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

export type IntegrationFixtures = {
  sidecar: SidecarHandle;
  staticServer: StaticServerHandle;
  apiBase: string;
};

export function createSidecarFixture(
  opts: {
    extraEnv?: Record<string, string>;
  } = {},
) {
  return base.extend<IntegrationFixtures>({
    sidecar: async ({}, run) => {
      const handle = await spawnSidecar({ extraEnv: opts.extraEnv });
      await run(handle);
      await handle.kill();
    },

    staticServer: async ({}, run) => {
      const handle = await startStaticServer(RENDERER_OUT_DIR);
      await run(handle);
      await handle.kill();
    },
    apiBase: async ({ sidecar }, run) => {
      await run(sidecar.baseUrl);
    },
  });
}

export async function installRendererBootstrap(
  page: import('@playwright/test').Page,
  apiBase: string,
  token: string,
): Promise<void> {
  await page.addInitScript(
    ({ apiBase, token }) => {
      (window as unknown as { __AUDIOMORPH_API_BASE__: string }).__AUDIOMORPH_API_BASE__ = apiBase;
      (window as unknown as { __AUDIOMORPH_TOKEN__: string }).__AUDIOMORPH_TOKEN__ = token;
    },
    { apiBase, token },
  );
}

export { TEST_TOKEN };

export function captureLeakAssertionString(): string {
  return TEST_TOKEN;
}
