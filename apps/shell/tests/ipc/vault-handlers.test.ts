import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

type IpcHandler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown> | unknown;

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, cb: IpcHandler) => {
        handlers.set(channel, cb);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
    },
    vault: {
      set: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve('super-secret-token')),
      delete: vi.fn(() => Promise.resolve()),
      has: vi.fn(() => Promise.resolve(true)),
    },
    audit: {
      append: vi.fn(() => Promise.resolve()),
    },
  };
});

vi.mock('electron', () => ({
  ipcMain: mocks.ipcMain,
}));

describe('vault IPC handlers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
  });

  it('vault:get returns { present } and never secret value', async () => {
    const mod = await import('../../src/ipc/vault-handlers');
    mod.registerVaultHandlers({ vault: mocks.vault, auditLog: mocks.audit });

    const handler = mocks.handlers.get('vault:get');
    const out = await handler?.({}, { key: 'hf_token' });

    expect(out).toEqual({ present: true });
    expect(JSON.stringify(out)).not.toContain('super-secret-token');
  });

  it('vault:set calls vault.set and returns ok', async () => {
    const mod = await import('../../src/ipc/vault-handlers');
    mod.registerVaultHandlers({ vault: mocks.vault, auditLog: mocks.audit });

    const handler = mocks.handlers.get('vault:set')!;
    const out = await handler({}, { key: 'openrouter_key', value: 'my-value' });

    expect(mocks.vault.set).toHaveBeenCalledWith('openrouter_key', 'my-value');
    expect(out).toEqual({ ok: true });
  });

  it('vault:delete calls vault.delete', async () => {
    const mod = await import('../../src/ipc/vault-handlers');
    mod.registerVaultHandlers({ vault: mocks.vault, auditLog: mocks.audit });

    const handler = mocks.handlers.get('vault:delete')!;
    await handler({}, { key: 'hf_token' });

    expect(mocks.vault.delete).toHaveBeenCalledWith('hf_token');
  });

  it('vault:has calls vault.has and returns present', async () => {
    const mod = await import('../../src/ipc/vault-handlers');
    mod.registerVaultHandlers({ vault: mocks.vault, auditLog: mocks.audit });

    const handler = mocks.handlers.get('vault:has')!;
    const out = await handler({}, { key: 'openrouter_key' });

    expect(mocks.vault.has).toHaveBeenCalledWith('openrouter_key');
    expect(out).toEqual({ present: true });
  });

  it('getSecretForSidecar returns decrypted value but IPC responses do not', async () => {
    const mod = await import('../../src/ipc/vault-handlers');
    mod.registerVaultHandlers({ vault: mocks.vault, auditLog: mocks.audit });

    const sidecarValue = await mod.getSecretForSidecar('hf_token', {
      vault: mocks.vault,
      auditLog: mocks.audit,
    });
    const getOut = await mocks.handlers.get('vault:get')?.({}, { key: 'hf_token' });

    expect(sidecarValue).toBe('super-secret-token');
    expect(getOut).toEqual({ present: true });
    expect(JSON.stringify(getOut)).not.toContain('super-secret-token');
  });
});
