'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useFirstRunStore } from '@/lib/stores/first-run';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';

type Model = {
  id: string;
  repo_id: string;
  name: string;
  size_gb: number;
  state: 'missing' | 'downloading' | 'verified' | 'partial' | 'corrupted';
};

const MIN_FREE_GB = 12;

export default function FirstRunPage() {
  const router = useRouter();
  const { step, modelsDir, freeDiskGb, downloadJobs, setStep, setModelsDir, setDownloadJob } =
    useFirstRunStore();
  const [models, setModels] = useState<Model[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<Record<string, () => void>>({});

  useEffect(() => {
    window.electronAPI
      .request({ method: 'GET', path: '/first-run/status' })
      .then((res: { status: number; body: unknown }) => {
        if (res.status >= 200 && res.status < 300) {
          const data = res.body as Record<string, unknown>;
          if (data.completed) router.replace('/');
        }
      })
      .catch(() => {});
  }, [router]);

  const pickDir = async () => {
    try {
      const result = await window.electronAPI.openDirectory({});
      if (result.canceled || !result.dirPath) return;
      const dir = result.dirPath;
      const ipc = (window as any).__AUDIOMORPH_IPC__;
      // TODO(disk-free): getDiskFreeGb is missing from electronAPI
      const freeGb = ipc?.getDiskFreeGb ? await ipc.getDiskFreeGb(dir) : 999;
      setModelsDir(dir, freeGb);
    } catch {
      toast.error('Could not open directory picker');
    }
  };

  useEffect(() => {
    if (step !== 3) return;
    window.electronAPI
      .request({ method: 'GET', path: '/models' })
      .then((res: { status: number; body: unknown }) => {
        if (res.status >= 200 && res.status < 300) {
          setModels(res.body as Model[]);
        } else {
          toast.error('Failed to load models');
        }
      })
      .catch(() => toast.error('Failed to load models'));
  }, [step]);

  const startDownload = async (model: Model) => {
    try {
      const res = await window.electronAPI.request({
        method: 'POST',
        path: `/models/${model.id}/download`,
      });
      if (res.status < 200 || res.status >= 300) throw new Error('HTTP Error');
      const { job_id } = res.body as Record<string, unknown>;

      setDownloadJob(model.id, {
        jobId: job_id,
        state: 'downloading',
        bytesDone: 0,
        totalBytes: 0,
        speedMbps: 0,
        currentFile: '',
      });

      const dispose = window.electronAPI.stream(
        { streamId: `download:${job_id}`, path: `/models/jobs/${job_id}/events` },
        (e: { event: string; data: unknown }) => {
          if (e.event === 'progress') {
            const d = e.data as Record<string, unknown>;
            setDownloadJob(model.id, {
              bytesDone: d.bytes_done,
              totalBytes: d.total_bytes,
              speedMbps: d.speed_mbps,
              currentFile: d.current_file,
            });
          } else if (e.event === 'done') {
            setDownloadJob(model.id, { state: 'done' });
            dispose();
            setActiveDownloads((prev) => {
              const n = { ...prev };
              delete n[model.id];
              return n;
            });
          } else if (e.event === 'error') {
            const msg = e.data ? (e.data as Record<string, unknown>).message : 'Download failed';
            setDownloadJob(model.id, { state: 'error', error: msg });
            toast.error(`${model.name}: ${msg}`);
            dispose();
            setActiveDownloads((prev) => {
              const n = { ...prev };
              delete n[model.id];
              return n;
            });
          }
        },
        () => {
          dispose();
        },
        (err: { message: string }) => {
          const msg = err.message || 'Download failed';
          setDownloadJob(model.id, { state: 'error', error: msg });
          toast.error(`${model.name}: ${msg}`);
          dispose();
          setActiveDownloads((prev) => {
            const n = { ...prev };
            delete n[model.id];
            return n;
          });
        },
      );

      setActiveDownloads((prev) => ({ ...prev, [model.id]: dispose }));
    } catch {
      toast.error(`Failed to start download for ${model.name}`);
    }
  };

  const cancelAll = () => {
    Object.entries(activeDownloads).forEach(([modelId, dispose]) => {
      const job = downloadJobs[modelId];
      if (job?.jobId) {
        window.electronAPI
          .request({
            method: 'DELETE',
            path: `/models/jobs/${job.jobId}`,
          })
          .catch(() => {});
      }
      dispose();
      setDownloadJob(modelId, { state: 'cancelled' });
    });
    setActiveDownloads({});
  };

  const allDone =
    models.length > 0 &&
    models.every((m) => downloadJobs[m.id]?.state === 'done' || m.state === 'verified');
  const anyDownloading = Object.values(downloadJobs).some((j) => j.state === 'downloading');

  const completeFirstRun = async () => {
    try {
      const res = await window.electronAPI.request({
        method: 'PUT',
        path: '/settings/first_run_completed',
        body: { value: 'true' },
      });
      if (res.status < 200 || res.status >= 300) throw new Error('Failed');
      router.replace('/');
    } catch {
      toast.error('Failed to complete setup');
    }
  };

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ background: 'var(--color-surface)' }}
      data-testid="first-run-wizard"
    >
      {/* AUDIOMORPH_TEST_MODE hook */}
      <span hidden data-testid="route-ready" />
      <div className="flex gap-3 mb-10" aria-label="Setup progress">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors"
            style={{
              background:
                s === step
                  ? 'var(--color-primary)'
                  : s < step
                    ? 'var(--color-success)'
                    : 'var(--color-surface-3)',
              color: s <= step ? 'var(--color-surface)' : 'var(--color-text-muted)',
            }}
            aria-current={s === step ? 'step' : undefined}
          >
            {s < step ? '✓' : s}
          </div>
        ))}
      </div>

      <div
        className="w-full max-w-lg rounded-2xl p-8 shadow-2xl"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
        role="main"
        aria-label={`Setup step ${step} of 4`}
      >
        {step === 1 && (
          <div className="flex flex-col gap-6 text-center">
            <h1 className="text-3xl font-bold" style={{ color: 'var(--color-text)' }}>
              AudioMorph Studio
            </h1>
            <p style={{ color: 'var(--color-text-muted)' }}>
              Local AI music generation — no cloud, no accounts. Let&apos;s get you set up.
            </p>
            <Button onClick={() => setStep(2)} data-testid="step1-next">
              Get started
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
              Choose models folder
            </h2>
            <p style={{ color: 'var(--color-text-muted)' }}>
              Models require ~10 GB of disk space. Choose a folder with enough free space.
            </p>
            <Button variant="outline" onClick={pickDir} data-testid="pick-dir-btn">
              {modelsDir || 'Select folder…'}
            </Button>
            {modelsDir && freeDiskGb !== null && freeDiskGb < MIN_FREE_GB && (
              <p
                className="text-sm"
                style={{ color: 'var(--color-danger)' }}
                data-testid="low-disk-error"
              >
                ⚠ Only {freeDiskGb.toFixed(1)} GB free — at least {MIN_FREE_GB} GB required.
              </p>
            )}
            {modelsDir && freeDiskGb !== null && freeDiskGb >= MIN_FREE_GB && (
              <p className="text-sm" style={{ color: 'var(--color-success)' }}>
                ✓ {freeDiskGb.toFixed(1)} GB free
              </p>
            )}
            <Button
              onClick={() => setStep(3)}
              disabled={!modelsDir || freeDiskGb === null || freeDiskGb < MIN_FREE_GB}
              data-testid="step2-next"
            >
              Next
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
              Download AI models
            </h2>
            <div className="flex flex-col gap-4">
              {models.map((model) => {
                const job = downloadJobs[model.id];
                const pct = job?.totalBytes
                  ? Math.round((job.bytesDone / job.totalBytes) * 100)
                  : 0;
                return (
                  <div
                    key={model.id}
                    className="flex flex-col gap-2"
                    data-testid={`model-row-${model.id}`}
                  >
                    <div className="flex justify-between items-center">
                      <span style={{ color: 'var(--color-text)' }}>{model.name}</span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {model.size_gb} GB
                      </span>
                    </div>
                    {job?.state === 'downloading' && (
                      <>
                        <Progress value={pct} data-testid={`progress-${model.id}`} />
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {pct}% · {job.speedMbps?.toFixed(1)} MB/s · {job.currentFile}
                        </span>
                      </>
                    )}
                    {job?.state === 'error' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--color-danger)' }}>
                          {job.error}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startDownload(model)}
                          data-testid={`retry-${model.id}`}
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                    {(job?.state === 'done' || model.state === 'verified') && (
                      <span className="text-xs" style={{ color: 'var(--color-success)' }}>
                        ✓ Ready
                      </span>
                    )}
                    {!job && model.state === 'missing' && (
                      <Button
                        size="sm"
                        onClick={() => startDownload(model)}
                        data-testid={`download-${model.id}`}
                      >
                        Download
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3">
              {anyDownloading && (
                <Button variant="outline" onClick={cancelAll} data-testid="cancel-all-btn">
                  Cancel all
                </Button>
              )}
              <Button onClick={() => setStep(4)} disabled={!allDone} data-testid="step3-next">
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-6 text-center">
            <h2 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
              You&apos;re all set!
            </h2>
            <p style={{ color: 'var(--color-text-muted)' }}>
              AudioMorph Studio is ready. Start creating music.
            </p>
            <Button onClick={completeFirstRun} data-testid="open-studio-btn">
              Open Studio
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
