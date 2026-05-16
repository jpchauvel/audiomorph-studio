import { app, safeStorage } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AuditLog, type AuditEvent } from './audit';

export type VaultKey = 'hf_token' | 'openrouter_key';

type VaultMap = Partial<Record<VaultKey, string>>;

export interface KeyVaultOptions {
  userDataPath?: string;
  vaultPath?: string;
  auditLog?: Pick<AuditLog, 'append'>;
  fsImpl?: Pick<typeof fs, 'readFile' | 'writeFile' | 'rename' | 'mkdir'>;
  encryption?: {
    isEncryptionAvailable: () => boolean;
    encryptString: (value: string) => Buffer;
    decryptString: (value: Buffer) => string;
  };
  logger?: Pick<Console, 'warn'>;
}

export class KeyVault {
  private readonly vaultPath: string;
  private readonly auditLog: Pick<AuditLog, 'append'>;
  private readonly fsImpl: Pick<typeof fs, 'readFile' | 'writeFile' | 'rename' | 'mkdir'>;
  private readonly encryption: {
    isEncryptionAvailable: () => boolean;
    encryptString: (value: string) => Buffer;
    decryptString: (value: Buffer) => string;
  };
  private readonly logger: Pick<Console, 'warn'>;
  private readonly inMemoryVault: VaultMap = {};

  public constructor(options: KeyVaultOptions = {}) {
    const userDataPath = options.userDataPath ?? app.getPath('userData');
    this.vaultPath = options.vaultPath ?? path.join(userDataPath, 'vault.enc');
    this.auditLog = options.auditLog ?? new AuditLog({ userDataPath });
    this.fsImpl = options.fsImpl ?? fs;
    this.encryption = options.encryption ?? safeStorage;
    this.logger = options.logger ?? console;

    // AUDIOMORPH_TEST_MODE hook
    if (process.env.AUDIOMORPH_TEST_MODE === '1') {
      this.logger.warn('[vault] test mode enabled - using in-memory storage');
    }
  }

  public async set(key: VaultKey, value: string): Promise<void> {
    const vault = await this.readVault();
    vault[key] = this.encryptValue(value);
    await this.writeVault(vault);
    await this.appendAudit({ action: 'set', key });
  }

  public async get(key: VaultKey): Promise<string | null> {
    const vault = await this.readVault();
    const raw = vault[key];
    if (!raw) return null;
    try {
      return this.decryptValue(raw);
    } catch (error) {
      this.logger.warn(
        `[vault] failed to decrypt key=${key}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  public async delete(key: VaultKey): Promise<void> {
    const vault = await this.readVault();
    delete vault[key];
    await this.writeVault(vault);
    await this.appendAudit({ action: 'delete', key });
  }

  public async has(key: VaultKey): Promise<boolean> {
    const vault = await this.readVault();
    return typeof vault[key] === 'string';
  }

  public async clear(): Promise<void> {
    await this.writeVault({});
    await this.appendAudit({ action: 'clear' });
  }

  private async readVault(): Promise<VaultMap> {
    if (process.env.AUDIOMORPH_TEST_MODE === '1') {
      return { ...this.inMemoryVault };
    }
    try {
      const data = await this.fsImpl.readFile(this.vaultPath, 'utf8');
      const parsed = JSON.parse(data) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      const map = parsed as Record<string, unknown>;
      const out: VaultMap = {};
      if (typeof map.hf_token === 'string') out.hf_token = map.hf_token;
      if (typeof map.openrouter_key === 'string') out.openrouter_key = map.openrouter_key;
      return out;
    } catch (error) {
      const nodeErr = error as NodeJS.ErrnoException;
      if (nodeErr?.code === 'ENOENT') {
        return {};
      }
      this.logger.warn(
        `[vault] failed to read vault: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return {};
    }
  }

  private async writeVault(vault: VaultMap): Promise<void> {
    if (process.env.AUDIOMORPH_TEST_MODE === '1') {
      Object.assign(this.inMemoryVault, vault);
      return;
    }
    await this.fsImpl.mkdir(path.dirname(this.vaultPath), { recursive: true });
    const tmpPath = `${this.vaultPath}.tmp`;
    await this.fsImpl.writeFile(tmpPath, JSON.stringify(vault), 'utf8');
    await this.fsImpl.rename(tmpPath, this.vaultPath);
  }

  private encryptValue(value: string): string {
    if (!this.encryption.isEncryptionAvailable()) {
      this.logger.warn('[vault] safeStorage unavailable; using base64-only fallback');
      return Buffer.from(value, 'utf8').toString('base64');
    }
    return this.encryption.encryptString(value).toString('base64');
  }

  private decryptValue(ciphertextB64: string): string {
    const asBuffer = Buffer.from(ciphertextB64, 'base64');
    if (!this.encryption.isEncryptionAvailable()) {
      this.logger.warn('[vault] safeStorage unavailable; using base64-only fallback');
      return asBuffer.toString('utf8');
    }
    return this.encryption.decryptString(asBuffer);
  }

  private async appendAudit(event: AuditEvent): Promise<void> {
    try {
      await this.auditLog.append(event);
    } catch (error) {
      this.logger.warn(
        `[vault] failed to append audit event: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
