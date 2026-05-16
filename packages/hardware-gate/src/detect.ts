import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { ExecFileException } from 'node:child_process';

export interface HardwareFailure {
  requirement: string;
  actual: string;
  message: string;
}

export interface HardwareReport {
  ok: boolean;
  failures: HardwareFailure[];
  details: {
    os: string;
    arch: string;
    gpu: string | null;
    vram_gb: number | null;
    ram_gb: number;
    disk_gb: number;
  };
}

const RAM_MIN_GB = 16;
const VRAM_MIN_GB = 8;
const DISK_MIN_GB = 30;

const LINUX_NVIDIA_SMI_FALLBACKS = ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi'];
const WINDOWS_NVIDIA_SMI_FALLBACKS = [
  'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  'C:\\Windows\\System32\\nvidia-smi.exe',
];

function roundGb(value: number): number {
  return Number(value.toFixed(1));
}

function bytesToGb(bytes: number): number {
  return bytes / 1024 ** 3;
}

function kbToGb(kb: number): number {
  return kb / 1024 ** 2;
}

function parseDfAvailableKb(stdout: string): number | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return null;
  }

  const dataLine = lines[lines.length - 1] ?? '';
  const cols = dataLine.split(/\s+/);
  const available = Number.parseFloat(cols[3] ?? '');
  return Number.isFinite(available) ? available : null;
}

function parseMacVramGb(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*GB/i);
  if (!match) return null;
  const gb = Number.parseFloat(match[1] ?? '');
  return Number.isFinite(gb) ? gb : null;
}

function parseMiBToGb(raw: string): number | null {
  const match = raw.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const mib = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(mib)) return null;
  return mib / 1024;
}

function parseWindowsGpuJson(
  json: string,
): Array<{ name: string; adapterRamBytes: number | null }> {
  const trimmed = json.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: Array<{ name: string; adapterRamBytes: number | null }> = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;
    const name = typeof entry.Name === 'string' ? entry.Name : '';
    const adapterRaw = entry.AdapterRAM;
    const adapterRam =
      typeof adapterRaw === 'number'
        ? adapterRaw
        : typeof adapterRaw === 'string'
          ? Number.parseFloat(adapterRaw)
          : NaN;

    out.push({
      name,
      adapterRamBytes: Number.isFinite(adapterRam) ? adapterRam : null,
    });
  }

  return out;
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error: ExecFileException | null, stdout: string | Buffer) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout ?? ''));
    });
  });
}

async function commandExists(file: string): Promise<boolean> {
  try {
    await execFileText(file, []);
    return true;
  } catch {
    return false;
  }
}

async function resolveNvidiaSmiPath(platform: NodeJS.Platform): Promise<string | null> {
  const candidates =
    platform === 'win32'
      ? ['nvidia-smi', ...WINDOWS_NVIDIA_SMI_FALLBACKS]
      : ['nvidia-smi', ...LINUX_NVIDIA_SMI_FALLBACKS];

  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function detect(): Promise<HardwareReport> {
  const failures: HardwareFailure[] = [];

  let ramGbMeasured = 0;
  let diskGbMeasured = 0;
  let vramGbMeasured: number | null = null;

  const details: HardwareReport['details'] = {
    os: process.platform,
    arch: process.arch,
    gpu: null,
    vram_gb: null,
    ram_gb: 0,
    disk_gb: 0,
  };

  if (process.platform === 'darwin') {
    try {
      const arm64 = (await execFileText('sysctl', ['-n', 'hw.optional.arm64'])).trim();
      if (arm64 !== '1') {
        failures.push({
          requirement: 'arm64',
          actual: 'x86_64',
          message: 'Apple Silicon (arm64) is required on macOS.',
        });
      }
    } catch {
      failures.push({
        requirement: 'arm64',
        actual: 'unknown',
        message: 'Could not verify Apple Silicon architecture.',
      });
    }

    try {
      const memBytes = Number.parseFloat(
        (await execFileText('sysctl', ['-n', 'hw.memsize'])).trim(),
      );
      if (Number.isFinite(memBytes)) {
        ramGbMeasured = bytesToGb(memBytes);
        details.ram_gb = roundGb(ramGbMeasured);
      }
    } catch {
      ramGbMeasured = 0;
      details.ram_gb = 0;
    }

    if (ramGbMeasured < RAM_MIN_GB) {
      failures.push({
        requirement: 'ram',
        actual: `${roundGb(ramGbMeasured).toFixed(1)} GB`,
        message: `At least ${RAM_MIN_GB.toFixed(1)} GB RAM is required.`,
      });
    }

    try {
      const dfOutput = await execFileText('df', ['-k', '/']);
      const availableKb = parseDfAvailableKb(dfOutput);
      if (availableKb !== null) {
        diskGbMeasured = kbToGb(availableKb);
        details.disk_gb = roundGb(diskGbMeasured);
      }
    } catch {
      diskGbMeasured = 0;
      details.disk_gb = 0;
    }

    if (diskGbMeasured < DISK_MIN_GB) {
      failures.push({
        requirement: 'disk',
        actual: `${roundGb(diskGbMeasured).toFixed(1)} GB`,
        message: `At least ${DISK_MIN_GB.toFixed(1)} GB free disk is required.`,
      });
    }

    try {
      const raw = await execFileText('system_profiler', ['SPDisplaysDataType', '-json']);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const displays = parsed.SPDisplaysDataType;
      if (Array.isArray(displays) && displays.length > 0) {
        const first = displays[0] as Record<string, unknown>;
        details.gpu = typeof first.sppci_model === 'string' ? first.sppci_model : null;
        const vram = parseMacVramGb(
          typeof first.spdisplays_vram === 'string' ? first.spdisplays_vram : undefined,
        );
        if (vram !== null) {
          vramGbMeasured = vram;
          details.vram_gb = roundGb(vramGbMeasured);
        }
      }
    } catch {
      details.gpu = null;
      vramGbMeasured = null;
      details.vram_gb = null;
    }

    if ((vramGbMeasured ?? 0) < VRAM_MIN_GB) {
      failures.push({
        requirement: 'vram',
        actual: vramGbMeasured === null ? 'unknown' : `${roundGb(vramGbMeasured).toFixed(1)} GB`,
        message: `At least ${VRAM_MIN_GB.toFixed(1)} GB VRAM is required.`,
      });
    }
  }

  if (process.platform === 'linux') {
    if (process.arch !== 'x64') {
      failures.push({
        requirement: 'arch',
        actual: process.arch,
        message: 'x64 architecture is required on Linux.',
      });
    }

    try {
      const meminfo = await readFile('/proc/meminfo', 'utf8');
      const match = meminfo.match(/^MemTotal:\s+([0-9]+)\s+kB$/m);
      const memKb = match ? Number.parseFloat(match[1] ?? '') : NaN;
      if (Number.isFinite(memKb)) {
        ramGbMeasured = kbToGb(memKb);
        details.ram_gb = roundGb(ramGbMeasured);
      }
    } catch {
      ramGbMeasured = 0;
      details.ram_gb = 0;
    }

    if (ramGbMeasured < RAM_MIN_GB) {
      failures.push({
        requirement: 'ram',
        actual: `${roundGb(ramGbMeasured).toFixed(1)} GB`,
        message: `At least ${RAM_MIN_GB.toFixed(1)} GB RAM is required.`,
      });
    }

    try {
      const dfOutput = await execFileText('df', ['-k', '/']);
      const availableKb = parseDfAvailableKb(dfOutput);
      if (availableKb !== null) {
        diskGbMeasured = kbToGb(availableKb);
        details.disk_gb = roundGb(diskGbMeasured);
      }
    } catch {
      diskGbMeasured = 0;
      details.disk_gb = 0;
    }

    if (diskGbMeasured < DISK_MIN_GB) {
      failures.push({
        requirement: 'disk',
        actual: `${roundGb(diskGbMeasured).toFixed(1)} GB`,
        message: `At least ${DISK_MIN_GB.toFixed(1)} GB free disk is required.`,
      });
    }

    const nvidiaSmi = await resolveNvidiaSmiPath('linux');
    if (!nvidiaSmi) {
      failures.push({
        requirement: 'nvidia_gpu',
        actual: 'not_detected',
        message: 'An NVIDIA GPU is required on Linux.',
      });
      failures.push({
        requirement: 'cuda',
        actual: 'nvidia-smi not found',
        message: 'CUDA runtime check failed: nvidia-smi is unavailable.',
      });
    } else {
      try {
        await execFileText(nvidiaSmi, []);
      } catch {
        failures.push({
          requirement: 'cuda',
          actual: 'nvidia-smi failed',
          message: 'CUDA runtime check failed: nvidia-smi returned non-zero exit code.',
        });
      }

      try {
        const csv = await execFileText(nvidiaSmi, [
          '--query-gpu=name,memory.total',
          '--format=csv,noheader',
        ]);
        const rows = csv
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        if (rows.length === 0) {
          failures.push({
            requirement: 'nvidia_gpu',
            actual: 'not_detected',
            message: 'An NVIDIA GPU is required on Linux.',
          });
        } else {
          let maxGb = 0;
          let maxName: string | null = null;
          for (const row of rows) {
            const [namePart, memPart] = row.split(',', 2).map((piece) => piece.trim());
            const gb = memPart ? parseMiBToGb(memPart) : null;
            if (gb !== null && gb > maxGb) {
              maxGb = gb;
              maxName = namePart || 'NVIDIA GPU';
            }
          }

          details.gpu = maxName;
          vramGbMeasured = maxGb > 0 ? maxGb : null;
          details.vram_gb = vramGbMeasured === null ? null : roundGb(vramGbMeasured);

          if (!details.gpu) {
            failures.push({
              requirement: 'nvidia_gpu',
              actual: 'not_detected',
              message: 'An NVIDIA GPU is required on Linux.',
            });
          }

          if ((vramGbMeasured ?? 0) < VRAM_MIN_GB) {
            failures.push({
              requirement: 'vram',
              actual:
                vramGbMeasured === null ? 'unknown' : `${roundGb(vramGbMeasured).toFixed(1)} GB`,
              message: `At least ${VRAM_MIN_GB.toFixed(1)} GB VRAM is required.`,
            });
          }
        }
      } catch {
        failures.push({
          requirement: 'nvidia_gpu',
          actual: 'query_failed',
          message: 'Failed to query NVIDIA GPU details via nvidia-smi.',
        });
      }
    }
  }

  if (process.platform === 'win32') {
    if (process.arch !== 'x64') {
      failures.push({
        requirement: 'arch',
        actual: process.arch,
        message: 'x64 architecture is required on Windows.',
      });
    }

    try {
      const ramRaw = await execFileText('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty TotalPhysicalMemory',
      ]);
      const bytes = Number.parseFloat(ramRaw.trim());
      if (Number.isFinite(bytes)) {
        ramGbMeasured = bytesToGb(bytes);
        details.ram_gb = roundGb(ramGbMeasured);
      }
    } catch {
      ramGbMeasured = 0;
      details.ram_gb = 0;
    }

    if (ramGbMeasured < RAM_MIN_GB) {
      failures.push({
        requirement: 'ram',
        actual: `${roundGb(ramGbMeasured).toFixed(1)} GB`,
        message: `At least ${RAM_MIN_GB.toFixed(1)} GB RAM is required.`,
      });
    }

    try {
      const diskRaw = await execFileText('powershell', [
        '-NoProfile',
        '-Command',
        'Get-PSDrive C | Select-Object -ExpandProperty Free',
      ]);
      const bytes = Number.parseFloat(diskRaw.trim());
      if (Number.isFinite(bytes)) {
        diskGbMeasured = bytesToGb(bytes);
        details.disk_gb = roundGb(diskGbMeasured);
      }
    } catch {
      diskGbMeasured = 0;
      details.disk_gb = 0;
    }

    if (diskGbMeasured < DISK_MIN_GB) {
      failures.push({
        requirement: 'disk',
        actual: `${roundGb(diskGbMeasured).toFixed(1)} GB`,
        message: `At least ${DISK_MIN_GB.toFixed(1)} GB free disk is required.`,
      });
    }

    try {
      const gpuJson = await execFileText('powershell', [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_VideoController | Where-Object {$_.Name -like '*NVIDIA*'} | Select-Object Name,AdapterRAM | ConvertTo-Json",
      ]);
      const gpus = parseWindowsGpuJson(gpuJson);
      if (gpus.length === 0) {
        failures.push({
          requirement: 'nvidia_gpu',
          actual: 'not_detected',
          message: 'An NVIDIA GPU is required on Windows.',
        });
      } else {
        const strongest = gpus
          .map((gpu) => ({
            name: gpu.name,
            vram_gb: gpu.adapterRamBytes === null ? null : roundGb(bytesToGb(gpu.adapterRamBytes)),
          }))
          .sort((a, b) => (b.vram_gb ?? 0) - (a.vram_gb ?? 0))[0];

        details.gpu = strongest?.name ?? null;
        vramGbMeasured = strongest?.vram_gb ?? null;
        details.vram_gb = vramGbMeasured;

        if ((vramGbMeasured ?? 0) < VRAM_MIN_GB) {
          failures.push({
            requirement: 'vram',
            actual: vramGbMeasured === null ? 'unknown' : `${vramGbMeasured.toFixed(1)} GB`,
            message: `At least ${VRAM_MIN_GB.toFixed(1)} GB VRAM is required.`,
          });
        }
      }
    } catch {
      failures.push({
        requirement: 'nvidia_gpu',
        actual: 'query_failed',
        message: 'Failed to query NVIDIA GPU details via PowerShell.',
      });
    }

    const nvidiaSmi = await resolveNvidiaSmiPath('win32');
    if (!nvidiaSmi) {
      failures.push({
        requirement: 'cuda',
        actual: 'nvidia-smi not found',
        message: 'CUDA runtime check failed: nvidia-smi is unavailable.',
      });
    } else {
      try {
        await execFileText(nvidiaSmi, []);
      } catch {
        failures.push({
          requirement: 'cuda',
          actual: 'nvidia-smi failed',
          message: 'CUDA runtime check failed: nvidia-smi returned non-zero exit code.',
        });
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    details,
  };
}
