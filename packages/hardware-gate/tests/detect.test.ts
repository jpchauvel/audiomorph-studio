import { beforeEach, describe, expect, it, vi } from 'vitest';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const mocks = vi.hoisted(() => {
  const execFile = vi.fn();
  const readFile = vi.fn();
  return { execFile, readFile };
});

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
}));

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

function setArch(arch: NodeJS.Architecture): void {
  Object.defineProperty(process, 'arch', { value: arch });
}

function withExecMap(map: Record<string, { stdout?: string; error?: Error }>): void {
  mocks.execFile.mockImplementation((file: string, args: string[], callback: ExecCallback) => {
    const key = `${file}|${args.join(' ')}`;
    const res = map[key];
    if (!res) {
      callback(new Error(`unexpected command ${key}`), '', '');
      return;
    }
    if (res.error) {
      callback(res.error, '', '');
      return;
    }
    callback(null, res.stdout ?? '', '');
  });
}

describe('hardware detect()', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('macOS arm64 with 32GB RAM, 100GB disk, 8GB VRAM -> ok true', async () => {
    setPlatform('darwin');
    setArch('arm64');
    withExecMap({
      'sysctl|-n hw.optional.arm64': { stdout: '1\n' },
      'sysctl|-n hw.memsize': { stdout: String(32 * 1024 ** 3) },
      'df|-k /': {
        stdout:
          'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1 100 20 104857600 1% 0 0 0% /\n',
      },
      'system_profiler|SPDisplaysDataType -json': {
        stdout: JSON.stringify({
          SPDisplaysDataType: [{ sppci_model: 'Apple M3', spdisplays_vram: '8 GB' }],
        }),
      },
    });

    const { detect } = await import('../src/detect');
    const report = await detect();

    expect(report.ok).toBe(true);
    expect(report.failures).toHaveLength(0);
    expect(report.details.ram_gb).toBe(32);
    expect(report.details.disk_gb).toBe(100);
    expect(report.details.vram_gb).toBe(8);
  });

  it('macOS Intel fails arm64 requirement', async () => {
    setPlatform('darwin');
    setArch('x64');
    withExecMap({
      'sysctl|-n hw.optional.arm64': { stdout: '0\n' },
      'sysctl|-n hw.memsize': { stdout: String(32 * 1024 ** 3) },
      'df|-k /': {
        stdout:
          'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1 100 20 104857600 1% 0 0 0% /\n',
      },
      'system_profiler|SPDisplaysDataType -json': {
        stdout: JSON.stringify({
          SPDisplaysDataType: [{ sppci_model: 'AMD', spdisplays_vram: '8 GB' }],
        }),
      },
    });

    const { detect } = await import('../src/detect');
    const report = await detect();

    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.requirement === 'arm64')).toBe(true);
  });

  it('macOS 8GB RAM fails ram requirement', async () => {
    setPlatform('darwin');
    setArch('arm64');
    withExecMap({
      'sysctl|-n hw.optional.arm64': { stdout: '1\n' },
      'sysctl|-n hw.memsize': { stdout: String(8 * 1024 ** 3) },
      'df|-k /': {
        stdout:
          'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1 100 20 104857600 1% 0 0 0% /\n',
      },
      'system_profiler|SPDisplaysDataType -json': {
        stdout: JSON.stringify({
          SPDisplaysDataType: [{ sppci_model: 'Apple M3', spdisplays_vram: '12 GB' }],
        }),
      },
    });

    const { detect } = await import('../src/detect');
    const report = await detect();

    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.requirement === 'ram')).toBe(true);
  });

  it('Linux NVIDIA 8GB VRAM passes', async () => {
    setPlatform('linux');
    setArch('x64');
    mocks.readFile.mockResolvedValue('MemTotal:       33554432 kB\n');
    withExecMap({
      'df|-k /': {
        stdout:
          'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1 1 52428800 10% /\n',
      },
      'nvidia-smi|': { stdout: 'NVIDIA-SMI 555.55\n' },
      'nvidia-smi|--query-gpu=name,memory.total --format=csv,noheader': {
        stdout: 'NVIDIA RTX 4070, 8192 MiB\n',
      },
    });

    const { detect } = await import('../src/detect');
    const report = await detect();

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('Linux without nvidia-smi fails nvidia_gpu', async () => {
    setPlatform('linux');
    setArch('x64');
    mocks.readFile.mockResolvedValue('MemTotal:       33554432 kB\n');
    withExecMap({
      'df|-k /': {
        stdout:
          'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1 1 52428800 10% /\n',
      },
      'nvidia-smi|': { error: new Error('missing') },
      '/usr/bin/nvidia-smi|': { error: new Error('missing') },
      '/usr/local/bin/nvidia-smi|': { error: new Error('missing') },
    });

    const { detect } = await import('../src/detect');
    const report = await detect();

    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.requirement === 'nvidia_gpu')).toBe(true);
  });

  it('Windows NVIDIA 6GB fails vram requirement', async () => {
    setPlatform('win32');
    setArch('x64');
    withExecMap({
      'powershell|-NoProfile -Command Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty TotalPhysicalMemory':
        {
          stdout: String(32 * 1024 ** 3),
        },
      'powershell|-NoProfile -Command Get-PSDrive C | Select-Object -ExpandProperty Free': {
        stdout: String(120 * 1024 ** 3),
      },
      "powershell|-NoProfile -Command Get-CimInstance Win32_VideoController | Where-Object {$_.Name -like '*NVIDIA*'} | Select-Object Name,AdapterRAM | ConvertTo-Json":
        {
          stdout: JSON.stringify({ Name: 'NVIDIA GeForce', AdapterRAM: 6 * 1024 ** 3 }),
        },
      'nvidia-smi|': { stdout: 'NVIDIA-SMI 555.55\n' },
    });

    const { detect } = await import('../src/detect');
    const report = await detect();

    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.requirement === 'vram')).toBe(true);
  });

  it('RAM threshold boundary: 16.0 passes and 15.9 fails', async () => {
    setPlatform('linux');
    setArch('x64');

    withExecMap({
      'df|-k /': {
        stdout:
          'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1 1 52428800 10% /\n',
      },
      'nvidia-smi|': { stdout: 'NVIDIA-SMI 555.55\n' },
      'nvidia-smi|--query-gpu=name,memory.total --format=csv,noheader': {
        stdout: 'NVIDIA RTX 4070, 8192 MiB\n',
      },
    });

    mocks.readFile.mockResolvedValueOnce('MemTotal:       16777216 kB\n');
    const { detect } = await import('../src/detect');
    const passReport = await detect();
    expect(passReport.ok).toBe(true);

    mocks.readFile.mockResolvedValueOnce('MemTotal:       16672358 kB\n');
    const failReport = await detect();
    expect(failReport.ok).toBe(false);
    expect(failReport.failures.some((f) => f.requirement === 'ram')).toBe(true);
  });

  it('nvidia-smi path fallback: PATH fails then common dir succeeds', async () => {
    setPlatform('linux');
    setArch('x64');
    mocks.readFile.mockResolvedValue('MemTotal:       33554432 kB\n');
    withExecMap({
      'df|-k /': {
        stdout:
          'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1 1 52428800 10% /\n',
      },
      'nvidia-smi|': { error: new Error('missing from PATH') },
      '/usr/bin/nvidia-smi|': { stdout: 'NVIDIA-SMI 555.55\n' },
      '/usr/bin/nvidia-smi|--query-gpu=name,memory.total --format=csv,noheader': {
        stdout: 'NVIDIA RTX 4080, 12288 MiB\n',
      },
    });

    const { detect } = await import('../src/detect');
    const report = await detect();

    expect(report.ok).toBe(true);
    expect(mocks.execFile).toHaveBeenCalledWith('/usr/bin/nvidia-smi', [], expect.any(Function));
  });
});
