'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useGenerationStore, GenPhase } from '@/lib/stores/generation';
import { GenerationForm, type GenerationRequest } from '@/components/generation/GenerationForm';
import { PhaseIndicator } from '@/components/generation/PhaseIndicator';
import { ResultCard } from '@/components/generation/ResultCard';

type Model = {
  id: string;
  name: string;
  role?: string;
  state: string;
};

const encodeModelId = (id: string): string => id.replace(/\//g, '__');

export default function StudioPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const streamDisposeRef = useRef<(() => void) | null>(null);
  const cancelRequestedRef = useRef(false);

  const {
    jobId,
    phase,
    numSongsTotal,
    numSongsDone,
    setJob,
    setPhase,
    setError,
    setResult,
    pushCompleted,
    setBatch,
    clearRun,
  } = useGenerationStore();

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api || typeof api.request !== 'function') {
      setIsLoadingModels(false);
      toast.error('Desktop bridge unavailable — please restart the app');
      return;
    }

    const fetchModels = async (): Promise<Model[]> => {
      const res = await api.request({ method: 'GET', path: '/models' });
      if (res.status < 200 || res.status >= 300) throw new Error('Failed to load models');
      const body = res.body as { items?: Model[] } | Model[] | null;
      return Array.isArray(body) ? body : (body?.items ?? []);
    };

    const silentReverify = async (m: Model) => {
      try {
        await api.request({ method: 'POST', path: `/models/${encodeModelId(m.id)}/verify` });
      } catch {
        void 0;
      }
    };

    void (async () => {
      try {
        const initial = await fetchModels();
        setHasDownloaded(initial.some((m) => m.state !== 'missing'));
        const reverifiable = initial.filter((m) => m.state !== 'missing');
        let latest = initial;
        if (reverifiable.length > 0) {
          await Promise.all(reverifiable.map(silentReverify));
          latest = await fetchModels();
          setHasDownloaded(latest.some((m) => m.state !== 'missing'));
        }
        setModels(
          latest.filter(
            (m) =>
              (m.state === 'verified' || m.state === 'partial') && m.role === 'generation',
          ),
        );
      } catch {
        toast.error('Failed to load models');
      } finally {
        setIsLoadingModels(false);
      }
    })();

    return () => {
      if (streamDisposeRef.current) {
        streamDisposeRef.current();
      }
    };
  }, []);

  const runSingleSong = (
    data: GenerationRequest,
    seedOverride: number | undefined,
  ): Promise<{ jobId: string }> =>
    new Promise((resolve, reject) => {
      const payload = { ...data, seed: seedOverride };
      void (async () => {
        try {
          const res = await window.electronAPI.request({
            method: 'POST',
            path: '/jobs/generate',
            body: payload,
          });
          if (res.status === 429) {
            reject(new Error('Too many requests. A generation is already in flight.'));
            return;
          }
          if (res.status < 200 || res.status >= 300) {
            reject(new Error('Failed to start generation'));
            return;
          }
          const { job_id } = res.body as { job_id: string };
          setJob(job_id);

          const dispose = window.electronAPI.stream(
            { streamId: `job-events-${job_id}`, path: `/jobs/${job_id}/events` },
            (e: { event: string; data: unknown }) => {
              if (e.event === 'progress') {
                const d = e.data as {
                  phase: GenPhase;
                  step: number;
                  total_steps: number;
                  eta_s: number;
                };
                setPhase(d.phase, d.step, d.total_steps, d.eta_s);
              } else if (e.event === 'done') {
                dispose();
                streamDisposeRef.current = null;
                resolve({ jobId: job_id });
              } else if (e.event === 'error') {
                const raw = JSON.stringify(e.data);
                const msg = e.data ? (e.data as { message?: string }).message : undefined;
                dispose();
                streamDisposeRef.current = null;
                reject(new Error(msg ?? `SSE-error payload: ${raw}`));
              } else if (e.event === 'cancelled') {
                dispose();
                streamDisposeRef.current = null;
                reject(new Error('cancelled'));
              }
            },
            () => {
              dispose();
              streamDisposeRef.current = null;
            },
            (err: { message?: string; code?: string }) => {
              const raw = JSON.stringify(err);
              dispose();
              streamDisposeRef.current = null;
              reject(new Error(err.message || `transport-error payload: ${raw}`));
            },
          );
          streamDisposeRef.current = dispose;
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Generation failed'));
        }
      })();
    });

  const handleSubmit = async (data: GenerationRequest) => {
    if (phase !== 'idle' && phase !== 'done' && phase !== 'error' && phase !== 'cancelled') {
      toast.error('Generation already in progress');
      return;
    }

    const total = Math.max(1, Math.min(8, Math.trunc(data.num_songs)));
    clearRun();
    setBatch(total);
    cancelRequestedRef.current = false;

    const baseSeed = data.seed;
    for (let i = 0; i < total; i += 1) {
      if (cancelRequestedRef.current) break;
      const seedForSong = baseSeed !== undefined ? baseSeed + i : undefined;
      try {
        const { jobId: completedId } = await runSingleSong(data, seedForSong);
        pushCompleted(completedId);
        if (i === total - 1) {
          setResult(completedId);
          if (total > 1) toast.success(`Generated ${total} songs`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Generation failed';
        if (msg === 'cancelled') {
          setPhase('cancelled');
          toast.info('Generation cancelled');
        } else {
          setError(msg);
          toast.error(`Error: ${msg}`);
        }
        return;
      }
    }
  };

  const handleCancel = async () => {
    cancelRequestedRef.current = true;
    if (!jobId) return;
    try {
      await window.electronAPI.request({ method: 'DELETE', path: `/jobs/${jobId}` });
      if (streamDisposeRef.current) {
        streamDisposeRef.current();
        streamDisposeRef.current = null;
      }
      setPhase('cancelled');
    } catch {
      toast.error('Failed to cancel job');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface)] text-[var(--color-text)]">
      <span hidden data-testid="route-ready" />

      <main className="flex-1 flex flex-col items-center p-8 max-w-4xl mx-auto w-full">
        <h1 className="self-start text-2xl font-bold mb-6">AudioMorph Studio</h1>
        {isLoadingModels ? (
          <div className="py-20 text-[var(--color-text-muted)] animate-pulse">
            Loading studio...
          </div>
        ) : models.length === 0 && !hasDownloaded ? (
          <div className="flex flex-col items-center justify-center p-12 border border-dashed border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-2)] w-full text-center">
            <div className="w-16 h-16 bg-[var(--color-surface-3)] rounded-full flex items-center justify-center mb-4 text-2xl">
              📥
            </div>
            <h2 className="text-xl font-semibold mb-2">No models downloaded yet</h2>
            <p className="text-[var(--color-text-muted)] mb-6 max-w-md">
              You need at least one downloaded generation model to start. Open the Models page to
              download HeartMuLaGen.
            </p>
            <Link
              href="/models"
              className="px-6 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-surface)] font-medium hover:opacity-90 transition-opacity"
            >
              Go to Models
            </Link>
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 border border-dashed border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-2)] w-full text-center">
            <h2 className="text-xl font-semibold mb-2">No generation model ready</h2>
            <p className="text-[var(--color-text-muted)] mb-6 max-w-md">
              Models are downloaded but no generation-capable pipeline is available yet. Open the
              Models page to verify or re-download HeartMuLaGen.
            </p>
            <Link
              href="/models"
              className="px-6 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-surface)] font-medium hover:opacity-90 transition-opacity"
            >
              Open Models
            </Link>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-8">
            <GenerationForm models={models} onSubmit={handleSubmit} onCancel={handleCancel} />

            <div className="w-full max-w-2xl mx-auto flex flex-col">
              {numSongsTotal > 1 && (numSongsDone > 0 || phase !== 'idle') && (
                <div className="text-sm text-[var(--color-text-muted)] mb-2">
                  Song {Math.min(numSongsDone + 1, numSongsTotal)} of {numSongsTotal}
                </div>
              )}
              <PhaseIndicator />
              <ResultCard />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
