import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const app = {
    exit: vi.fn(),
  };
  const dialog = {
    showErrorBox: vi.fn(),
  };
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const ipcMain = {
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, handler);
    }),
  };

  const detect = vi.fn();
  return { app, dialog, ipcMain, handlers, detect };
});

vi.mock('electron', () => ({
  app: mocks.app,
  dialog: mocks.dialog,
  ipcMain: mocks.ipcMain,
}));

vi.mock('@audiomorph/hardware-gate', () => ({
  detect: mocks.detect,
}));

describe('hardware check enforcement and IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
  });

  it('enforceHardwareRequirements passes when detect() returns ok=true', async () => {
    mocks.detect.mockResolvedValue({
      ok: true,
      failures: [],
      details: {
        os: 'darwin',
        arch: 'arm64',
        gpu: 'Apple M3',
        vram_gb: 8,
        ram_gb: 16,
        disk_gb: 100,
      },
    });

    const mod = await import('../../src/hardware/hardware-check');
    await mod.enforceHardwareRequirements();

    expect(mocks.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(mocks.app.exit).not.toHaveBeenCalled();
  });

  it('enforceHardwareRequirements shows dialog and exits with code 1 when detect fails', async () => {
    mocks.detect.mockResolvedValue({
      ok: false,
      failures: [
        {
          requirement: 'ram',
          actual: '8.0 GB',
          message: 'At least 16.0 GB RAM is required.',
        },
      ],
      details: {
        os: 'darwin',
        arch: 'arm64',
        gpu: 'Apple M1',
        vram_gb: 8,
        ram_gb: 8,
        disk_gb: 100,
      },
    });

    const mod = await import('../../src/hardware/hardware-check');
    await mod.enforceHardwareRequirements();

    expect(mocks.dialog.showErrorBox).toHaveBeenCalledWith(
      'System Requirements Not Met',
      expect.stringContaining('ram'),
    );
    expect(mocks.app.exit).toHaveBeenCalledWith(1);
  });

  it('registerHardwareIpcHandler registers hardware:check and returns HardwareReport', async () => {
    const report = {
      ok: true,
      failures: [],
      details: {
        os: 'linux',
        arch: 'x64',
        gpu: 'NVIDIA RTX',
        vram_gb: 12,
        ram_gb: 32,
        disk_gb: 200,
      },
    };
    mocks.detect.mockResolvedValue(report);

    const mod = await import('../../src/hardware/hardware-check');
    mod.registerHardwareIpcHandler();

    const handler = mocks.handlers.get('hardware:check');
    expect(handler).toBeDefined();

    const out = await handler?.({}, undefined);
    expect(out).toEqual(report);
  });
});
