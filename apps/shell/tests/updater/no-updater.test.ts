import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: "1.0.1" } })),
    checkForUpdatesAndNotify: vi.fn(async () => ({ updateInfo: { version: "1.0.1" } })),
    on: vi.fn(),
  };
  return { autoUpdater };
});

vi.mock("electron", () => ({
  autoUpdater: mocks.autoUpdater,
}));

describe("no-updater guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.autoUpdater.autoDownload = true;
    mocks.autoUpdater.autoInstallOnAppQuit = true;
    mocks.autoUpdater.checkForUpdates = vi.fn(async () => ({ updateInfo: { version: "1.0.1" } }));
    mocks.autoUpdater.checkForUpdatesAndNotify = vi.fn(async () => ({ updateInfo: { version: "1.0.1" } }));
  });

  it("sets autoDownload to false", async () => {
    const mod = await import("../../src/updater/no-updater");
    mod.disableAutoUpdater();
    expect(mocks.autoUpdater.autoDownload).toBe(false);
  });

  it("sets autoInstallOnAppQuit to false", async () => {
    const mod = await import("../../src/updater/no-updater");
    mod.disableAutoUpdater();
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("checkForUpdates becomes a no-op", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mod = await import("../../src/updater/no-updater");
    mod.disableAutoUpdater();

    await expect(mocks.autoUpdater.checkForUpdates()).resolves.toEqual({
      updateInfo: null,
      cancellationToken: null,
    });
    expect(warn).toHaveBeenCalledWith("Auto-update is disabled in AudioMorph Studio");
    warn.mockRestore();
  });

  it("checkForUpdatesAndNotify becomes a no-op", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mod = await import("../../src/updater/no-updater");
    mod.disableAutoUpdater();

    await expect(mocks.autoUpdater.checkForUpdatesAndNotify()).resolves.toEqual({
      updateInfo: null,
      cancellationToken: null,
    });
    expect(warn).toHaveBeenCalledWith("Auto-update is disabled in AudioMorph Studio");
    warn.mockRestore();
  });

  it("registers update-available listener that does not download", async () => {
    const mod = await import("../../src/updater/no-updater");
    mod.disableAutoUpdater();

    expect(mocks.autoUpdater.on).toHaveBeenCalledWith("update-available", expect.any(Function));

    const listener = mocks.autoUpdater.on.mock.calls.find((call) => call[0] === "update-available")?.[1] as (() => void) | undefined;
    expect(listener).toBeTypeOf("function");

    const original = vi.isMockFunction(mocks.autoUpdater.checkForUpdates)
      ? mocks.autoUpdater.checkForUpdates.mock.calls.length
      : 0;
    listener?.();
    const after = vi.isMockFunction(mocks.autoUpdater.checkForUpdates)
      ? mocks.autoUpdater.checkForUpdates.mock.calls.length
      : 0;
    expect(after).toBe(original);
  });
});
