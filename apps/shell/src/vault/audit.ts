import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type AuditEvent =
  | { action: 'set'; key: string }
  | { action: 'delete'; key: string }
  | { action: 'clear' }
  | { action: 'get'; key: string; found: boolean }
  | { action: 'ipc_set'; key: string }
  | { action: 'ipc_get'; key: string; present: boolean }
  | { action: 'ipc_delete'; key: string }
  | { action: 'ipc_has'; key: string; present: boolean };

export interface AuditLogOptions {
  userDataPath?: string;
  logPath?: string;
}

export class AuditLog {
  private readonly logPath: string;

  public constructor(options: AuditLogOptions = {}) {
    const userDataPath = options.userDataPath ?? app.getPath('userData');
    this.logPath = options.logPath ?? path.join(userDataPath, 'logs', 'vault-audit.log');
  }

  public async append(event: AuditEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    const line = JSON.stringify({ ...event, ts: new Date().toISOString(), pid: process.pid });
    await fs.appendFile(this.logPath, `${line}\n`, 'utf8');
  }
}
