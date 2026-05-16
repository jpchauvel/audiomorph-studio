'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type HardwareFailure = {
  requirement: string;
  actual: string;
  message: string;
};

type HardwareReport = {
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
};

const EMPTY_REPORT: HardwareReport = {
  ok: false,
  failures: [],
  details: {
    os: 'unknown',
    arch: 'unknown',
    gpu: null,
    vram_gb: null,
    ram_gb: 0,
    disk_gb: 0,
  },
};

const RAM_MIN_GB = 16;
const VRAM_MIN_GB = 8;
const DISK_MIN_GB = 30;

function formatValue(value: string | number | null, unit = ''): string {
  if (value === null) return 'Unknown';
  if (typeof value === 'number') return `${value.toFixed(1)}${unit}`;
  return value;
}

function getFailureMap(failures: HardwareFailure[]): Map<string, HardwareFailure> {
  return new Map(failures.map((failure) => [failure.requirement, failure]));
}

export default function DiagnosticsPage() {
  const [report, setReport] = useState<HardwareReport>(EMPTY_REPORT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function run(): Promise<void> {
      try {
        if (!window.electronAPI?.hardwareCheck) {
          throw new Error('Hardware diagnostics are only available in the desktop app.');
        }

        const data = await window.electronAPI.hardwareCheck();
        if (active) {
          setReport(data);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to run hardware diagnostics');
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, []);

  const failuresByRequirement = useMemo(() => getFailureMap(report.failures), [report.failures]);

  const rows = [
    {
      key: 'os',
      label: 'Operating System',
      value: report.details.os,
      ok: true,
    },
    {
      key: 'arch',
      label: 'Architecture',
      value: report.details.arch,
      ok: !failuresByRequirement.has('arch') && !failuresByRequirement.has('arm64'),
      threshold: 'arm64 on macOS, x64 on Windows/Linux',
      failure: failuresByRequirement.get('arch') ?? failuresByRequirement.get('arm64'),
    },
    {
      key: 'gpu',
      label: 'GPU',
      value: report.details.gpu ?? 'None detected',
      ok: !failuresByRequirement.has('nvidia_gpu'),
      threshold: report.details.os === 'darwin' ? 'Any Metal-capable GPU' : 'NVIDIA GPU required',
      failure: failuresByRequirement.get('nvidia_gpu'),
    },
    {
      key: 'vram',
      label: 'VRAM',
      value: formatValue(report.details.vram_gb, ' GB'),
      ok: !failuresByRequirement.has('vram'),
      threshold: `≥ ${VRAM_MIN_GB.toFixed(1)} GB`,
      failure: failuresByRequirement.get('vram'),
    },
    {
      key: 'ram',
      label: 'RAM',
      value: formatValue(report.details.ram_gb, ' GB'),
      ok: !failuresByRequirement.has('ram'),
      threshold: `≥ ${RAM_MIN_GB.toFixed(1)} GB`,
      failure: failuresByRequirement.get('ram'),
    },
    {
      key: 'disk',
      label: 'Free Disk',
      value: formatValue(report.details.disk_gb, ' GB'),
      ok: !failuresByRequirement.has('disk'),
      threshold: `≥ ${DISK_MIN_GB.toFixed(1)} GB`,
      failure: failuresByRequirement.get('disk'),
    },
  ];

  return (
    <div className="container mx-auto max-w-4xl space-y-6 p-8">
      {/* AUDIOMORPH_TEST_MODE hook */}
      <span hidden data-testid="route-ready" />
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Hardware Diagnostics</h1>
        <Link
          href="/settings"
          className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text hover:bg-surface-3"
        >
          Back to Settings
        </Link>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-surface-2 p-6 text-text-muted">
          Running hardware checks…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger bg-danger/10 p-6 text-danger">{error}</div>
      ) : (
        <>
          <div
            className={`rounded-xl border p-4 ${
              report.ok
                ? 'border-success bg-success/10 text-success'
                : 'border-danger bg-danger/10 text-danger'
            }`}
          >
            <p className="font-semibold">
              {report.ok ? 'All requirements met' : 'Requirements not met'}
            </p>
            {!report.ok && report.failures.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {report.failures.map((failure, index) => (
                  <li key={`${failure.requirement}-${index}`}>
                    <span className="font-medium">{failure.requirement}:</span> {failure.message} (
                    {failure.actual})
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
            <table className="w-full table-auto text-left text-sm">
              <thead className="border-b border-border bg-surface-3">
                <tr>
                  <th className="px-4 py-3 font-semibold text-text">Check</th>
                  <th className="px-4 py-3 font-semibold text-text">Detected</th>
                  <th className="px-4 py-3 font-semibold text-text">Requirement</th>
                  <th className="px-4 py-3 font-semibold text-text">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-border/70 last:border-b-0">
                    <td className="px-4 py-3 text-text">{row.label}</td>
                    <td className="px-4 py-3 text-text-muted">{row.value}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {row.threshold ?? 'Informational'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={row.ok ? 'text-success' : 'text-danger'}>
                        {row.ok ? '✓ Pass' : '✗ Fail'}
                      </span>
                      {!row.ok && row.failure ? (
                        <p className="mt-1 text-xs text-danger">{row.failure.message}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
