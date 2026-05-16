import { mkdtemp, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/tmp/audiomorph-test'),
  },
}));

vi.mock('electron', () => ({
  app: mocks.app,
}));

describe('AuditLog', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('append writes JSON line to log file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audit-test-'));
    const { AuditLog } = await import('../../src/vault/audit');
    const audit = new AuditLog({ userDataPath: root });

    await audit.append({ action: 'set', key: 'hf_token' });

    const file = await readFile(path.join(root, 'logs', 'vault-audit.log'), 'utf8');
    const lines = file.trim().split('\n');
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(row.action).toBe('set');
    expect(row.key).toBe('hf_token');
    expect(typeof row.ts).toBe('string');
    expect(typeof row.pid).toBe('number');
  });

  it('never logs secret value content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audit-test-'));
    const { AuditLog } = await import('../../src/vault/audit');
    const audit = new AuditLog({ userDataPath: root });

    const secretMarker = 'my-super-secret-value';
    await audit.append({ action: 'set', key: 'openrouter_key' });

    const file = await readFile(path.join(root, 'logs', 'vault-audit.log'), 'utf8');
    expect(file).not.toContain(secretMarker);
  });

  it('multiple appends produce multiple lines', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audit-test-'));
    const { AuditLog } = await import('../../src/vault/audit');
    const audit = new AuditLog({ userDataPath: root });

    await audit.append({ action: 'set', key: 'hf_token' });
    await audit.append({ action: 'delete', key: 'hf_token' });
    await audit.append({ action: 'clear' });

    const file = await readFile(path.join(root, 'logs', 'vault-audit.log'), 'utf8');
    const lines = file.trim().split('\n');
    expect(lines).toHaveLength(3);
  });
});
