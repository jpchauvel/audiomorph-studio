import { mkdtemp, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const app = {
    exit: vi.fn(),
    setPath: vi.fn(),
  };
  const crashReporter = {
    start: vi.fn(),
  };
  return { app, crashReporter };
});

vi.mock('electron', () => ({
  app: mocks.app,
  crashReporter: mocks.crashReporter,
}));

describe('crash-reporter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  });

  it('starts crashReporter with uploadToServer disabled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'crash-reporter-start-'));
    const mod = await import('../../src/crash/crash-reporter');

    mod.setupCrashReporter(root);

    expect(mocks.crashReporter.start).toHaveBeenCalledWith(
      expect.objectContaining({
        submitURL: '',
        uploadToServer: false,
        compress: true,
      }),
    );
  });

  it('uncaught exception writes crash JSON file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'crash-reporter-uncaught-'));
    const mod = await import('../../src/crash/crash-reporter');
    const crashDir = mod.getCrashLogDir(root);

    mod.setupCrashReporter(root);

    const handler = process.listeners('uncaughtException').at(-1) as (err: unknown) => void;
    handler(new Error('boom'));

    const files = await import('node:fs/promises').then((fs) => fs.readdir(crashDir));
    expect(files.length).toBe(1);
    const payload = await readFile(path.join(crashDir, files[0] ?? ''), 'utf8');
    const parsed = JSON.parse(payload) as { type: string; message: string; ts: string };
    expect(parsed.type).toBe('uncaughtException');
    expect(parsed.message).toContain('boom');
    expect(parsed.ts).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('sanitizes Bearer and X-Audiomorph-Token values', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'crash-reporter-sanitize-'));
    const mod = await import('../../src/crash/crash-reporter');
    const crashDir = mod.getCrashLogDir(root);

    mod.setupCrashReporter(root);

    const handler = process.listeners('unhandledRejection').at(-1) as (err: unknown) => void;
    handler('Bearer abc123 X-Audiomorph-Token: secret-token');

    const files = await import('node:fs/promises').then((fs) => fs.readdir(crashDir));
    const payload = await readFile(path.join(crashDir, files[0] ?? ''), 'utf8');
    expect(payload).not.toContain('abc123');
    expect(payload).not.toContain('secret-token');
    expect(payload).toContain('Bearer [REDACTED]');
    expect(payload).toContain('X-Audiomorph-Token: [REDACTED]');
  });

  it('calls app.exit(1) after crash write', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'crash-reporter-exit-'));
    const mod = await import('../../src/crash/crash-reporter');

    mod.setupCrashReporter(root);
    const handler = process.listeners('uncaughtException').at(-1) as (err: unknown) => void;
    handler(new Error('fatal'));

    expect(mocks.app.exit).toHaveBeenCalledWith(1);
  });

  it('getCrashLogDir resolves to userData/logs/crashes', async () => {
    const mod = await import('../../src/crash/crash-reporter');
    expect(mod.getCrashLogDir('/tmp/user-data')).toBe(
      path.join('/tmp/user-data', 'logs', 'crashes'),
    );
  });
});
