import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';
import * as readline from 'node:readline';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

import { maskToken, SidecarFileLogger, type SidecarLogWriter } from './logger';

type SidecarProcess = ReturnType<typeof spawn>;

interface HandshakePayload {
  port: number;
  token: string;
  pid: number;
}

interface SidecarManagerOptions {
  userDataPath: string;
  logger?: SidecarLogWriter;
  handshakeTimeoutMs?: number;
  healthIntervalMs?: number;
  shutdownWaitMs?: number;
  termWaitMs?: number;
  now?: () => number;
  processKiller?: (pid: number, signal?: NodeJS.Signals | number) => void;
  tokenGenerator?: () => string;
}

interface CrashPayload {
  exitCode: number;
  lastLogs: string[];
}

const PLATFORM_MAP: Record<string, string> = {
  darwin: 'macos-arm64',
  win32: 'windows-x64',
  linux: 'linux-x64',
};

const HEALTH_FAILURE_THRESHOLD = 3;
const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 5 * 60 * 1000;

export class SidecarManager extends EventEmitter {
  private static instance: SidecarManager | null = null;

  private readonly userDataPath: string;
  private readonly logger: SidecarLogWriter;
  private readonly handshakeTimeoutMs: number;
  private readonly healthIntervalMs: number;
  private readonly shutdownWaitMs: number;
  private readonly termWaitMs: number;
  private readonly now: () => number;
  private readonly processKiller: (pid: number, signal?: NodeJS.Signals | number) => void;
  private readonly tokenGenerator: () => string;

  private readonly restartTimestamps: number[] = [];
  private readonly recentLogs: string[] = [];

  private child: SidecarProcess | null = null;
  private port: number | null = null;
  private token: string | null = null;
  private shuttingDown = false;
  private healthFailures = 0;
  private healthTimer: NodeJS.Timeout | null = null;

  public static getInstance(options?: SidecarManagerOptions): SidecarManager {
    if (!SidecarManager.instance) {
      if (!options) {
        throw new Error('SidecarManager.getInstance requires options on first call');
      }
      SidecarManager.instance = new SidecarManager(options);
    }
    return SidecarManager.instance;
  }

  public static resetInstanceForTests(): void {
    SidecarManager.instance = null;
  }

  public constructor(options: SidecarManagerOptions) {
    super();
    this.userDataPath = options.userDataPath;
    this.logger = options.logger ?? new SidecarFileLogger({ userDataPath: this.userDataPath });
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 30_000;
    this.healthIntervalMs = options.healthIntervalMs ?? 5_000;
    this.shutdownWaitMs = options.shutdownWaitMs ?? 5_000;
    this.termWaitMs = options.termWaitMs ?? 3_000;
    this.now = options.now ?? (() => Date.now());
    this.processKiller = options.processKiller ?? ((pid, signal) => process.kill(pid, signal));
    this.tokenGenerator = options.tokenGenerator ?? (() => randomBytes(32).toString('hex'));
  }

  public getApiBaseUrl(): string {
    if (this.port == null) {
      throw new Error('Sidecar is not ready');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  public getApiToken(): string {
    if (!this.token) {
      throw new Error('Sidecar token is not available');
    }
    return this.token;
  }

  public async start(): Promise<void> {
    this.shuttingDown = false;
    await this.reapZombieProcess();
    await this.spawnAndHandshake();
    this.startHealthChecks();
    this.emit('sidecar:ready');
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.stopHealthChecks();

    try {
      if (this.port != null && this.token) {
        await this.postInternalShutdown();
      }

      if (!(await this.waitForExit(this.shutdownWaitMs))) {
        this.sendSignal('SIGTERM');
        if (!(await this.waitForExit(this.termWaitMs))) {
          this.sendSignal('SIGKILL');
          await this.waitForExit(250);
        }
      }
    } finally {
      this.clearRuntimeState();
      this.deletePidFile();
      this.shuttingDown = false;
    }
  }

  public async reapZombieProcess(): Promise<void> {
    const pidPath = this.pidFilePath();
    try {
      if (!fs.existsSync(pidPath)) {
        return;
      }

      const raw = fs.readFileSync(pidPath, 'utf8').trim();
      const pid = Number.parseInt(raw, 10);
      if (Number.isFinite(pid) && this.isProcessAlive(pid)) {
        const cmdline = this.readProcessCommandLine(pid);
        if (cmdline.includes('audiomorph')) {
          this.processKiller(pid, 'SIGKILL');
        }
      }
    } finally {
      this.deletePidFile();
    }
  }

  private async spawnAndHandshake(): Promise<void> {
    const pythonPath = this.resolvePythonPath();
    const launchToken = this.tokenGenerator();
    const handshakeFile = path.join(
      os.tmpdir(),
      `audiomorph-handshake-${randomBytes(8).toString('hex')}.json`,
    );

    const env =
      process.env.AUDIOMORPH_TEST_MODE === '1'
        ? { ...process.env, AUDIOMORPH_TEST_MODE: '1' }
        : process.env;

    const proc = spawn(
      pythonPath,
      [
        '-m',
        'audiomorph',
        '--port',
        '0',
        '--parent-pid',
        String(process.pid),
        '--auth-token',
        launchToken,
        '--handshake-file',
        handshakeFile,
      ],
      {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      },
    );

    this.child = proc;
    this.token = launchToken;
    this.port = null;
    this.healthFailures = 0;
    this.attachExitHandler(proc);
    fs.writeFileSync(this.pidFilePath(), `${proc.pid}\n`, 'utf8');

    try {
      const payload = await this.readHandshake(proc, launchToken, handshakeFile);
      this.port = payload.port;
      this.token = payload.token;
    } finally {
      try {
        fs.unlinkSync(handshakeFile);
      } catch {
        void 0;
      }
    }
  }

  private resolvePythonPath(): string {
    if (process.env.NODE_ENV === 'development') {
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
      const pythonExe = process.platform === 'win32' ? 'python.exe' : 'python';
      const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
      // Priority: README setup (apps/sidecar/.venv) > legacy repo-root .venv.
      const candidates = [
        path.join(repoRoot, 'apps', 'sidecar', '.venv', binDir, pythonExe),
        path.join(repoRoot, '.venv', binDir, pythonExe),
      ];
      const found = candidates.find((p) => {
        try {
          fs.accessSync(p, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
      if (!found) {
        throw new Error(
          `Sidecar Python venv not found. Looked in:\n  ${candidates.join('\n  ')}\n` +
            `Create it with: cd apps/sidecar && python -m venv .venv && ` +
            `source .venv/bin/activate && pip install -e ".[dev]"`,
        );
      }
      return found;
    }

    const mapped = PLATFORM_MAP[process.platform];
    if (!mapped) {
      throw new Error(`Unsupported platform for sidecar runtime: ${process.platform}`);
    }

    if (process.platform === 'win32') {
      return path.join(process.resourcesPath, 'python', mapped, 'python.exe');
    }
    return path.join(process.resourcesPath, 'python', mapped, 'bin', 'python3');
  }

  private readHandshake(
    proc: SidecarProcess,
    launchToken: string,
    handshakeFile: string,
  ): Promise<HandshakePayload> {
    return new Promise<HandshakePayload>((resolve, reject) => {
      const stdout = proc.stdout;
      const stderr = proc.stderr;
      if (!stdout || !stderr) {
        reject(new Error('Sidecar stdio pipes not available'));
        return;
      }

      const outRl = readline.createInterface({ input: stdout });
      const errRl = readline.createInterface({ input: stderr });
      let settled = false;
      let pollTimer: NodeJS.Timeout | null = null;

      outRl.on('line', (line) => {
        this.handleOutputLine('stdout', this.sanitizeLine(line, launchToken));
      });
      errRl.on('line', (line) => {
        this.handleOutputLine('stderr', line);
      });

      const stopPoll = (): void => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stopPoll();
        outRl.close();
        errRl.close();
        this.sendSignal('SIGKILL');
        reject(new Error('Timed out waiting for sidecar handshake'));
      }, this.handshakeTimeoutMs);

      const finish = (payload: HandshakePayload): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stopPoll();
        resolve(payload);
      };

      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stopPoll();
        reject(err);
      };

      const tryReadHandshake = (): void => {
        if (settled) return;
        let raw: string;
        try {
          raw = fs.readFileSync(handshakeFile, 'utf8');
        } catch {
          return;
        }
        if (!raw.trim()) return;

        let parsed: Partial<HandshakePayload>;
        try {
          parsed = JSON.parse(raw) as Partial<HandshakePayload>;
        } catch {
          fail(new Error('Handshake file is not valid JSON'));
          return;
        }

        if (
          typeof parsed.port !== 'number' ||
          typeof parsed.token !== 'string' ||
          typeof parsed.pid !== 'number'
        ) {
          fail(new Error('Invalid sidecar handshake payload'));
          return;
        }
        if (parsed.token !== launchToken) {
          fail(new Error('Sidecar handshake token mismatch'));
          return;
        }

        this.logger.log(
          'stdout',
          `sidecar listening on 127.0.0.1:${parsed.port}, token=${maskToken(parsed.token)}`,
        );
        finish(parsed as HandshakePayload);
      };

      pollTimer = setInterval(tryReadHandshake, 50);
      tryReadHandshake();

      proc.once('error', (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      proc.once('exit', (code) => {
        if (!settled) {
          fail(new Error(`Sidecar exited before handshake (code=${String(code)})`));
        }
      });
    });
  }

  private attachExitHandler(proc: SidecarProcess): void {
    proc.on('exit', (code) => {
      const exitCode = code ?? -1;
      const unexpected = !this.shuttingDown && exitCode !== 0;
      this.stopHealthChecks();
      if (unexpected) {
        const crashPayload: CrashPayload = {
          exitCode,
          lastLogs: [...this.recentLogs],
        };
        this.emit('sidecar:crashed', crashPayload);
        void this.restartAfterFailure();
      }
    });
  }

  private startHealthChecks(): void {
    this.stopHealthChecks();
    this.healthTimer = setInterval(() => {
      void this.runHealthCheck();
    }, this.healthIntervalMs);
  }

  private stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async runHealthCheck(): Promise<void> {
    if (this.shuttingDown || this.port == null) {
      return;
    }

    const healthy = await this.fetchHealthz();
    if (healthy) {
      this.healthFailures = 0;
      return;
    }

    this.healthFailures += 1;
    if (this.healthFailures < HEALTH_FAILURE_THRESHOLD) {
      return;
    }

    this.healthFailures = 0;
    this.emit('sidecar:unhealthy');
    await this.restartAfterFailure();
  }

  private fetchHealthz(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.port == null) {
        resolve(false);
        return;
      }

      const req = http.get(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: '/healthz',
          method: 'GET',
          timeout: 2_000,
        },
        (res) => {
          res.resume();
          resolve((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300);
        },
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
    });
  }

  private async restartAfterFailure(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    const nowTs = this.now();
    const windowStart = nowTs - RESTART_WINDOW_MS;
    while (this.restartTimestamps.length > 0 && this.restartTimestamps[0]! < windowStart) {
      this.restartTimestamps.shift();
    }

    if (this.restartTimestamps.length >= RESTART_LIMIT) {
      this.emit('sidecar:fatal');
      return;
    }

    this.restartTimestamps.push(nowTs);
    this.sendSignal('SIGKILL');
    await this.waitForExit(500);
    this.deletePidFile();
    await this.spawnAndHandshake();
    this.startHealthChecks();
    this.emit('sidecar:ready');
  }

  private async postInternalShutdown(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.port == null || !this.token) {
        resolve();
        return;
      }
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: '/internal/shutdown',
          method: 'POST',
          headers: {
            'X-Audiomorph-Token': this.token,
          },
          timeout: 2_000,
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.on('error', () => resolve());
      req.end();
    });
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = this.child;
      if (!proc || proc.exitCode != null) {
        resolve(true);
        return;
      }

      let done = false;
      const finish = (result: boolean): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        proc.off('exit', onExit);
        resolve(result);
      };

      const onExit = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      proc.once('exit', onExit);
    });
  }

  private sendSignal(signal: NodeJS.Signals): void {
    const proc = this.child;
    if (!proc || typeof proc.pid !== 'number') {
      return;
    }
    try {
      proc.kill(signal);
    } catch {
      // no-op
    }
  }

  private handleOutputLine(stream: 'stdout' | 'stderr', line: string): void {
    const safe = this.sanitizeLine(line, this.token ?? '');
    this.pushRecentLog(safe);
    this.logger.log(stream, safe);
  }

  private sanitizeLine(line: string, token: string): string {
    if (!token) return line;
    return line.split(token).join(maskToken(token));
  }

  private pushRecentLog(line: string): void {
    this.recentLogs.push(line);
    if (this.recentLogs.length > 50) {
      this.recentLogs.splice(0, this.recentLogs.length - 50);
    }
  }

  private clearRuntimeState(): void {
    this.child = null;
    this.port = null;
    this.token = null;
    this.healthFailures = 0;
  }

  private pidFilePath(): string {
    return path.join(this.userDataPath, 'sidecar.pid');
  }

  private deletePidFile(): void {
    try {
      if (fs.existsSync(this.pidFilePath())) {
        fs.unlinkSync(this.pidFilePath());
      }
    } catch {
      // no-op
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      this.processKiller(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private readProcessCommandLine(pid: number): string {
    if (process.platform === 'win32') {
      return '';
    }
    try {
      const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
      });
      return (result.stdout ?? '').trim();
    } catch {
      return '';
    }
  }
}
