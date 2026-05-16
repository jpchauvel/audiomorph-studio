import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_ROTATIONS = 5;

export interface SidecarLogWriter {
  log(stream: "stdout" | "stderr", line: string): void;
}

export interface SidecarFileLoggerOptions {
  userDataPath: string;
  maxBytes?: number;
  maxRotations?: number;
}

function utcDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextLogPath(logDir: string, now: Date): string {
  return path.join(logDir, `sidecar-${utcDateStamp(now)}.log`);
}

export function maskToken(token: string): string {
  if (!token) return "***";
  return `${token.slice(0, 1)}***`;
}

export class SidecarFileLogger implements SidecarLogWriter {
  private readonly logDir: string;
  private readonly maxBytes: number;
  private readonly maxRotations: number;

  public constructor(options: SidecarFileLoggerOptions) {
    this.logDir = path.join(options.userDataPath, "logs");
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxRotations = options.maxRotations ?? DEFAULT_MAX_ROTATIONS;
  }

  public log(stream: "stdout" | "stderr", line: string): void {
    fs.mkdirSync(this.logDir, { recursive: true });
    const logPath = nextLogPath(this.logDir, new Date());
    const payload = `${new Date().toISOString()} [${stream}] ${line}\n`;
    this.rotateIfNeeded(logPath, Buffer.byteLength(payload, "utf8"));
    fs.appendFileSync(logPath, payload, "utf8");
  }

  private rotateIfNeeded(logPath: string, incomingBytes: number): void {
    const existingSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    if (existingSize + incomingBytes <= this.maxBytes) {
      return;
    }

    const oldestPath = `${logPath}.${this.maxRotations}`;
    if (fs.existsSync(oldestPath)) {
      fs.unlinkSync(oldestPath);
    }

    for (let i = this.maxRotations - 1; i >= 1; i -= 1) {
      const from = `${logPath}.${i}`;
      const to = `${logPath}.${i + 1}`;
      if (fs.existsSync(from)) {
        fs.renameSync(from, to);
      }
    }

    if (fs.existsSync(logPath)) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  }
}
