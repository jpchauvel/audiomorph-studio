import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    spawnMock: vi.fn(),
    spawnSyncMock: vi.fn(() => ({ stdout: '' })),
    fsExistsSync: vi.fn((p: string) => files.has(p)),
    fsReadFileSync: vi.fn((p: string) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(p) ?? '';
    }),
    fsWriteFileSync: vi.fn((p: string, data: string) => {
      files.set(p, data);
    }),
    fsUnlinkSync: vi.fn((p: string) => {
      files.delete(p);
    }),
    fsMkdirSync: vi.fn(),
    fsStatSync: vi.fn(() => ({ size: 0 })),
    fsAppendFileSync: vi.fn(),
    fsRenameSync: vi.fn(),
    fsAccessSync: vi.fn(),
    httpGetMock: vi.fn(),
    httpRequestMock: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  spawn: mocks.spawnMock,
  spawnSync: mocks.spawnSyncMock,
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.fsExistsSync,
  readFileSync: mocks.fsReadFileSync,
  writeFileSync: mocks.fsWriteFileSync,
  unlinkSync: mocks.fsUnlinkSync,
  mkdirSync: mocks.fsMkdirSync,
  statSync: mocks.fsStatSync,
  appendFileSync: mocks.fsAppendFileSync,
  renameSync: mocks.fsRenameSync,
  accessSync: mocks.fsAccessSync,
  constants: { X_OK: 1 },
}));

vi.mock('node:http', () => ({
  get: mocks.httpGetMock,
  request: mocks.httpRequestMock,
}));

class FakeChild extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly pid: number;
  public readonly kill: ReturnType<typeof vi.fn>;
  public killed = false;
  public exitCode: number | null = null;

  public constructor(pid: number, onKill?: (signal?: NodeJS.Signals | number) => void) {
    super();
    this.pid = pid;
    this.kill = vi.fn((signal?: NodeJS.Signals | number) => {
      this.killed = true;
      if (onKill) onKill(signal);
      return true;
    });
  }
}

function extractHandshakeFile(spawnArgs: readonly string[]): string {
  const idx = spawnArgs.indexOf('--handshake-file');
  if (idx === -1 || idx + 1 >= spawnArgs.length) {
    throw new Error('spawn args missing --handshake-file');
  }
  const value = spawnArgs[idx + 1];
  if (typeof value !== 'string') {
    throw new Error('--handshake-file value not a string');
  }
  return value;
}

function writeHandshake(
  spawnArgs: readonly string[],
  port = 40123,
  token = 'aabbccddeeff',
  pid = 99999,
): void {
  const file = extractHandshakeFile(spawnArgs);
  mocks.files.set(file, `${JSON.stringify({ port, token, pid })}\n`);
}

function setupHttpMocks(): void {
  mocks.httpGetMock.mockImplementation(
    (_opts, cb?: (res: EventEmitter & { statusCode?: number; resume: () => void }) => void) => {
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => undefined;
      const res = new EventEmitter() as EventEmitter & { statusCode?: number; resume: () => void };
      res.statusCode = 200;
      res.resume = () => undefined;
      if (cb) cb(res);
      return req;
    },
  );

  mocks.httpRequestMock.mockImplementation(
    (_opts, cb?: (res: EventEmitter & { resume: () => void }) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => undefined;
      req.end = () => {
        if (cb) {
          const res = new EventEmitter() as EventEmitter & { resume: () => void };
          res.resume = () => undefined;
          cb(res);
        }
      };
      return req;
    },
  );
}

describe('SidecarManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.files.clear();
    process.env.NODE_ENV = 'development';
    setupHttpMocks();
  });

  it('spawn + handshake happy path emits ready and exposes API base URL', async () => {
    const child = new FakeChild(1101);
    mocks.spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
      writeHandshake(args, 43210, 'atesttoken', 1101);
      return child;
    });

    const { SidecarManager } = await import('../../src/sidecar/manager');
    const manager = new SidecarManager({
      userDataPath: '/tmp/audiomorph',
      logger: { log: vi.fn() },
      tokenGenerator: () => 'atesttoken',
    });

    const ready = vi.fn();
    manager.on('sidecar:ready', ready);

    await manager.start();

    expect(ready).toHaveBeenCalledTimes(1);
    expect(manager.getApiBaseUrl()).toBe('http://127.0.0.1:43210');
    expect(manager.getApiToken()).toBe('atesttoken');

    const spawnCall = mocks.spawnMock.mock.calls[0];
    expect(spawnCall).toBeDefined();
    const args = spawnCall![1] as readonly string[];
    expect(args).toContain('-m');
    expect(args).toContain('audiomorph');
    expect(args).toContain('--parent-pid');
    expect(args).toContain('--auth-token');
    expect(args).toContain('atesttoken');
    expect(args).toContain('--handshake-file');
  });

  it('handshake timeout rejects when no handshake file arrives', async () => {
    vi.useFakeTimers();
    const child = new FakeChild(1102);
    mocks.spawnMock.mockReturnValue(child);

    const { SidecarManager } = await import('../../src/sidecar/manager');
    const manager = new SidecarManager({
      userDataPath: '/tmp/audiomorph',
      logger: { log: vi.fn() },
      handshakeTimeoutMs: 100,
    });

    const promise = manager.start();
    const assertion = expect(promise).rejects.toThrow('Timed out waiting for sidecar handshake');
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    vi.useRealTimers();
  });

  it('graceful shutdown deletes pid file when process exits on SIGTERM', async () => {
    vi.useFakeTimers();
    const child = new FakeChild(1103, (signal) => {
      if (signal === 'SIGTERM') {
        setTimeout(() => {
          child.exitCode = 0;
          child.emit('exit', 0);
        }, 10);
      }
    });

    mocks.spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
      writeHandshake(args, 42000, 'aterm', 1103);
      return child;
    });

    const { SidecarManager } = await import('../../src/sidecar/manager');
    const manager = new SidecarManager({
      userDataPath: '/tmp/audiomorph',
      logger: { log: vi.fn() },
      tokenGenerator: () => 'aterm',
    });

    await manager.start();
    const shutdownPromise = manager.shutdown();
    await vi.advanceTimersByTimeAsync(5_050);
    await shutdownPromise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mocks.fsUnlinkSync).toHaveBeenCalledWith('/tmp/audiomorph/sidecar.pid');
    vi.useRealTimers();
  });

  it('force kills sidecar when process hangs after SIGTERM', async () => {
    vi.useFakeTimers();
    const child = new FakeChild(1104);
    mocks.spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
      writeHandshake(args, 42001, 'ahang', 1104);
      return child;
    });

    const { SidecarManager } = await import('../../src/sidecar/manager');
    const manager = new SidecarManager({
      userDataPath: '/tmp/audiomorph',
      logger: { log: vi.fn() },
      tokenGenerator: () => 'ahang',
    });

    await manager.start();
    const shutdownPromise = manager.shutdown();
    await vi.advanceTimersByTimeAsync(8_400);
    await shutdownPromise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    vi.useRealTimers();
  });

  it('zombie reaper SIGKILLs existing audiomorph pid before spawn', async () => {
    mocks.files.set('/tmp/audiomorph/sidecar.pid', '999\n');
    mocks.spawnSyncMock.mockReturnValue({ stdout: 'python -m audiomorph --port 0' });

    const killer = vi.fn((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) return;
      if (signal !== 'SIGKILL') throw new Error('unexpected signal');
      if (pid !== 999) throw new Error('unexpected pid');
    });

    const child = new FakeChild(1105);
    mocks.spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
      writeHandshake(args, 42002, 'azombie', 1105);
      return child;
    });

    const { SidecarManager } = await import('../../src/sidecar/manager');
    const manager = new SidecarManager({
      userDataPath: '/tmp/audiomorph',
      logger: { log: vi.fn() },
      processKiller: killer,
      tokenGenerator: () => 'azombie',
    });

    await manager.start();

    const killCall = killer.mock.calls.find(([, signal]) => signal === 'SIGKILL');
    expect(killCall?.[0]).toBe(999);
    expect(mocks.fsUnlinkSync).toHaveBeenCalledWith('/tmp/audiomorph/sidecar.pid');
    expect(mocks.spawnMock).toHaveBeenCalledTimes(1);
  });

  it('restart loop guard emits fatal after crash loop and prevents further restart', async () => {
    const children: FakeChild[] = [
      new FakeChild(1201),
      new FakeChild(1202),
      new FakeChild(1203),
      new FakeChild(1204),
      new FakeChild(1205),
    ];
    let spawnIndex = 0;
    mocks.spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
      const child = children[spawnIndex] ?? new FakeChild(1300 + spawnIndex);
      spawnIndex += 1;
      writeHandshake(args, 43000 + spawnIndex, 'arest', child.pid);
      return child;
    });

    const nowValues = [0, 1_000, 2_000, 3_000, 4_000, 5_000];
    const now = vi.fn(() => nowValues.shift() ?? 5_000);

    const { SidecarManager } = await import('../../src/sidecar/manager');
    const manager = new SidecarManager({
      userDataPath: '/tmp/audiomorph',
      logger: { log: vi.fn() },
      now,
      tokenGenerator: () => 'arest',
    });

    const fatal = vi.fn();
    manager.on('sidecar:fatal', fatal);

    await manager.start();

    for (let i = 0; i < 4; i += 1) {
      const active = children[i];
      active.exitCode = 1;
      active.emit('exit', 1);
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(fatal).toHaveBeenCalledTimes(1);
    expect(mocks.spawnMock).toHaveBeenCalledTimes(4);
  });

  it('never logs raw token in sidecar output', async () => {
    const rawToken = 'sensitive-token-123';
    const logger = { log: vi.fn() };
    const child = new FakeChild(1106);

    mocks.spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
      writeHandshake(args, 45555, rawToken, 1106);
      return child;
    });

    const { SidecarManager } = await import('../../src/sidecar/manager');
    const manager = new SidecarManager({
      userDataPath: '/tmp/audiomorph',
      logger,
      tokenGenerator: () => rawToken,
    });

    await manager.start();
    child.stdout.write(`runtime token=${rawToken}\n`);
    child.stderr.write(`stderr token=${rawToken}\n`);

    const joinedLogs = logger.log.mock.calls.map((c) => String(c[1])).join('\n');
    expect(joinedLogs).not.toContain(rawToken);
    expect(joinedLogs).toContain('s***');
  });
});
