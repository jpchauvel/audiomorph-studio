import { ipcMain } from 'electron';
import type {
  VaultDeleteInput,
  VaultGetInput,
  VaultHasInput,
  VaultSetInput,
} from '@audiomorph/ipc-contracts';
import { AuditLog } from '../vault/audit';
import { KeyVault, type VaultKey } from '../vault/vault';

type VaultLike = Pick<KeyVault, 'set' | 'get' | 'delete' | 'has'>;
type AuditLike = Pick<AuditLog, 'append'>;

let defaultVault: VaultLike | null = null;
let defaultAudit: AuditLike | null = null;

function getVault(vault?: VaultLike): VaultLike {
  if (vault) return vault;
  if (!defaultVault) {
    defaultVault = new KeyVault();
  }
  return defaultVault;
}

function getAudit(audit?: AuditLike): AuditLike {
  if (audit) return audit;
  if (!defaultAudit) {
    defaultAudit = new AuditLog();
  }
  return defaultAudit;
}

export interface RegisterVaultHandlersOptions {
  vault?: VaultLike;
  auditLog?: AuditLike;
}

export function registerVaultHandlers(options: RegisterVaultHandlersOptions = {}): void {
  const vault = getVault(options.vault);
  const audit = getAudit(options.auditLog);

  if (typeof ipcMain.removeHandler === 'function') {
    ipcMain.removeHandler('vault:set');
    ipcMain.removeHandler('vault:get');
    ipcMain.removeHandler('vault:delete');
    ipcMain.removeHandler('vault:has');
  }

  ipcMain.handle('vault:set', async (_event, payload: VaultSetInput) => {
    await vault.set(payload.key, payload.value);
    await audit.append({ action: 'ipc_set', key: payload.key });
    return { ok: true } as const;
  });

  ipcMain.handle('vault:get', async (_event, payload: VaultGetInput) => {
    const present = await vault.has(payload.key);
    await audit.append({ action: 'ipc_get', key: payload.key, present });
    return { present } as const;
  });

  ipcMain.handle('vault:delete', async (_event, payload: VaultDeleteInput) => {
    await vault.delete(payload.key);
    await audit.append({ action: 'ipc_delete', key: payload.key });
    return { ok: true } as const;
  });

  ipcMain.handle('vault:has', async (_event, payload: VaultHasInput) => {
    const present = await vault.has(payload.key);
    await audit.append({ action: 'ipc_has', key: payload.key, present });
    return { present } as const;
  });
}

export async function getSecretForSidecar(
  key: VaultKey,
  options: RegisterVaultHandlersOptions = {},
): Promise<string | null> {
  const vault = getVault(options.vault);
  const audit = getAudit(options.auditLog);
  const value = await vault.get(key);
  await audit.append({ action: 'get', key, found: value !== null });
  return value;
}
