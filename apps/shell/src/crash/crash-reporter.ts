import { app, crashReporter } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

type CrashType = "uncaughtException" | "unhandledRejection";

interface CrashReport {
  ts: string;
  type: CrashType;
  message: string;
  stack: string;
}

const BEARER_REGEX = /Bearer\s+\S+/g;
const AUDIOMORPH_TOKEN_HEADER_REGEX = /X-Audiomorph-Token:\s*\S+/gi;

function sanitize(value: string): string {
  return value.replace(BEARER_REGEX, "Bearer [REDACTED]").replace(AUDIOMORPH_TOKEN_HEADER_REGEX, "X-Audiomorph-Token: [REDACTED]");
}

function extractErrorPayload(errorLike: unknown): { message: string; stack: string } {
  if (errorLike instanceof Error) {
    return {
      message: sanitize(errorLike.message ?? "Unknown error"),
      stack: sanitize(errorLike.stack ?? ""),
    };
  }

  const raw = sanitize(String(errorLike));
  return { message: raw, stack: raw };
}

function createCrashHandler(type: CrashType, crashDir: string): (errorLike: unknown) => void {
  return (errorLike: unknown): void => {
    const ts = new Date().toISOString();
    const { message, stack } = extractErrorPayload(errorLike);

    const report: CrashReport = {
      ts,
      type,
      message,
      stack,
    };

    try {
      const filePath = path.join(crashDir, `crash-${ts}.json`);
      writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
    } finally {
      app.exit(1);
    }
  };
}

export function getCrashLogDir(userDataPath: string): string {
  return path.join(userDataPath, "logs", "crashes");
}

export function setupCrashReporter(userDataPath: string): void {
  const crashDir = getCrashLogDir(userDataPath);
  mkdirSync(crashDir, { recursive: true });
  app.setPath("crashDumps", crashDir);

  crashReporter.start({
    submitURL: "",
    uploadToServer: false,
    compress: true,
  });

  process.on("uncaughtException", createCrashHandler("uncaughtException", crashDir));
  process.on("unhandledRejection", createCrashHandler("unhandledRejection", crashDir));
}
