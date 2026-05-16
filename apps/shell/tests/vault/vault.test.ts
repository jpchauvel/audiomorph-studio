import { mkdtemp, readFile, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const app = {
    getPath: vi.fn(() => "/tmp/audiomorph-test"),
  };
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`, "utf8")),
    decryptString: vi.fn((value: Buffer) => value.toString("utf8").replace(/^enc:/, "")),
  };
  return { app, safeStorage };
});

vi.mock("electron", () => ({
  app: mocks.app,
  safeStorage: mocks.safeStorage,
}));

describe("KeyVault", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function makeVault() {
    const root = await mkdtemp(path.join(os.tmpdir(), "vault-test-"));
    const { KeyVault } = await import("../../src/vault/vault");
    const audit = { append: vi.fn(() => Promise.resolve()) };
    const logger = { warn: vi.fn() };
    const vault = new KeyVault({
      userDataPath: root,
      auditLog: audit,
      logger,
    });
    return { root, vault, audit, logger };
  }

  it("set encrypts and writes vault file", async () => {
    const { root, vault } = await makeVault();
    await vault.set("hf_token", "secret-value");

    const raw = await readFile(path.join(root, "vault.enc"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, string>;

    expect(parsed.hf_token).toBe(Buffer.from("enc:secret-value", "utf8").toString("base64"));
    expect(mocks.safeStorage.encryptString).toHaveBeenCalledWith("secret-value");
  });

  it("get decrypts and returns value", async () => {
    const { vault } = await makeVault();
    await vault.set("openrouter_key", "or-secret");

    const value = await vault.get("openrouter_key");
    expect(value).toBe("or-secret");
  });

  it("get returns null for missing key", async () => {
    const { vault } = await makeVault();
    const value = await vault.get("hf_token");
    expect(value).toBeNull();
  });

  it("delete removes key from vault", async () => {
    const { root, vault } = await makeVault();
    await vault.set("hf_token", "abc");
    await vault.delete("hf_token");

    const raw = await readFile(path.join(root, "vault.enc"), "utf8");
    expect(JSON.parse(raw)).toEqual({});
  });

  it("has returns true/false without decrypting", async () => {
    const { vault } = await makeVault();
    await vault.set("openrouter_key", "abc");
    mocks.safeStorage.decryptString.mockClear();

    await expect(vault.has("openrouter_key")).resolves.toBe(true);
    await expect(vault.has("hf_token")).resolves.toBe(false);
    expect(mocks.safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it("clear empties vault", async () => {
    const { root, vault } = await makeVault();
    await vault.set("hf_token", "a");
    await vault.set("openrouter_key", "b");
    await vault.clear();

    const raw = await readFile(path.join(root, "vault.enc"), "utf8");
    expect(JSON.parse(raw)).toEqual({});
  });

  it("atomic write uses vault.tmp renamed to vault.enc", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vault-atomic-"));
    const rename = vi.fn(async (from: string, to: string) => {
      const data = await readFile(from, "utf8");
      await import("node:fs/promises").then((m) => m.writeFile(to, data, "utf8"));
      await import("node:fs/promises").then((m) => m.unlink(from));
    });
    const fsImpl = {
      readFile,
      writeFile: (await import("node:fs/promises")).writeFile,
      rename,
      mkdir: (await import("node:fs/promises")).mkdir,
    };

    const { KeyVault } = await import("../../src/vault/vault");
    const vault = new KeyVault({ userDataPath: root, fsImpl, auditLog: { append: vi.fn() } });
    await vault.set("hf_token", "atomic-secret");

    expect(rename).toHaveBeenCalledTimes(1);
    const [tmpPath, finalPath] = rename.mock.calls[0] as [string, string];
    expect(tmpPath).toBe(path.join(root, "vault.enc.tmp"));
    expect(finalPath).toBe(path.join(root, "vault.enc"));
    await expect(stat(finalPath)).resolves.toBeDefined();
  });

  it("safeStorage unavailable falls back to base64 only without throw", async () => {
    const { vault, logger } = await makeVault();
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false);

    await expect(vault.set("hf_token", "plainish")).resolves.toBeUndefined();
    await expect(vault.get("hf_token")).resolves.toBe("plainish");
    expect(logger.warn).toHaveBeenCalled();
  });
});
