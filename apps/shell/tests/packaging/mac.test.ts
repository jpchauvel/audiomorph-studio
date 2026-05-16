import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(__dirname, "../../../..");
const shellDir = resolve(__dirname, "../..");

const requiredEntitlements = [
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
];

function runBuildScriptEnvGuard(env: NodeJS.ProcessEnv): { code: number; stderr: string } {
  const requiredVars = [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ];

  for (const variable of requiredVars) {
    if (!env[variable]) {
      return {
        code: 1,
        stderr: `Missing required env var: ${variable}`,
      };
    }
  }

  return { code: 0, stderr: "" };
}

describe("mac packaging", () => {
  beforeEach(() => {
    process.env.AUDIOMORPH_SHELL_TEST = "1";
  });

  it("entitlements plist is valid XML and contains all required keys", () => {
    const plistPath = resolve(shellDir, "build/entitlements.mac.plist");
    const xml = readFileSync(plistPath, "utf8");

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain("<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\"");
    expect(xml).toContain("<plist version=\"1.0\">");
    expect(xml).toContain("<dict>");

    for (const key of requiredEntitlements) {
      expect(xml).toContain(`<key>${key}</key>`);
    }
  });

  it("sign-python afterPack hook exports a function", async () => {
    const hookPath = resolve(shellDir, "build/sign-python.js");
    const mod = await import(hookPath);
    expect(typeof mod.default).toBe("function");
  });

  it("build script contains required env guards", () => {
    const scriptPath = resolve(rootDir, "scripts/build-mac.sh");
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain('require_env "CSC_LINK"');
    expect(script).toContain('require_env "CSC_KEY_PASSWORD"');
    expect(script).toContain('require_env "APPLE_ID"');
    expect(script).toContain('require_env "APPLE_APP_SPECIFIC_PASSWORD"');
    expect(script).toContain('require_env "APPLE_TEAM_ID"');
  });

  it("env guard logic fails fast with descriptive missing variable", () => {
    const result = runBuildScriptEnvGuard({
      CSC_LINK: "base64:p12",
      CSC_KEY_PASSWORD: "secret",
      APPLE_ID: "dev@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("Missing required env var: APPLE_TEAM_ID");
  });

  it("env guard logic passes when all required variables are set", () => {
    const result = runBuildScriptEnvGuard({
      CSC_LINK: "base64:p12",
      CSC_KEY_PASSWORD: "secret",
      APPLE_ID: "dev@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl",
      APPLE_TEAM_ID: "TEAM12345",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });
});
