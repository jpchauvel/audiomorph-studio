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
  state: string;
};

export default function StudioPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const streamDisposeRef = useRef<(() => void) | null>(null);

  const { jobId, phase, setJob, setPhase, setError, setResult, reset } = useGenerationStore();

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api || typeof api.request !== 'function') {
      setIsLoadingModels(false);
      toast.error('Desktop bridge unavailable — please restart the app');
      return;
    }

    try {
      api
        .request({ method: 'GET', path: '/models' })
        .then((res: { status: number; body: unknown }) => {
          if (res.status >= 200 && res.status < 300) {
            const body = res.body as { items?: Model[] } | Model[] | null;
            const items = Array.isArray(body) ? body : (body?.items ?? []);
            setModels(items.filter((m) => m.state === 'verified'));
          } else {
            throw new Error('Failed to load models');
          }
        })
        .catch(() => {
          toast.error('Failed to load models');
        })
        .finally(() => {
          setIsLoadingModels(false);
        });
    } catch {
      setIsLoadingModels(false);
      toast.error('Failed to load models');
    }

    return () => {
      if (streamDisposeRef.current) {
        streamDisposeRef.current();
      }
    };
  }, []);

  const handleSubmit = async (data: GenerationRequest) => {
    if (phase !== 'idle' && phase !== 'done' && phase !== 'error' && phase !== 'cancelled') {
      toast.error('Generation already in progress');
      return;
    }

    try {
      reset();
      const res = await window.electronAPI.request({
        method: 'POST',
        path: '/jobs/generate',
        body: data,
      });

      if (res.status === 429) {
        toast.error('Too many requests. A generation is already in flight.');
        return;
      }

      if (res.status < 200 || res.status >= 300) {
        throw new Error('Failed to start generation');
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
            setResult(job_id);
            dispose();
            streamDisposeRef.current = null;
          } else if (e.event === 'error') {
            const msg = e.data ? (e.data as { message?: string }).message : 'Generation failed';
            setError(msg ?? 'Generation failed');
            toast.error(`Error: ${msg}`);
            dispose();
            streamDisposeRef.current = null;
          } else if (e.event === 'cancelled') {
            setPhase('cancelled');
            toast.info('Generation cancelled');
            dispose();
            streamDisposeRef.current = null;
          }
        },
        () => {
          dispose();
          streamDisposeRef.current = null;
        },
        (err: { message: string }) => {
          const msg = err.message || 'Generation failed';
          setError(msg);
          toast.error(`Error: ${msg}`);
          dispose();
          streamDisposeRef.current = null;
        },
      );
      streamDisposeRef.current = dispose;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setError(msg);
      toast.error(msg);
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;

    try {
      await window.electronAPI.request({
        method: 'DELETE',
        path: `/jobs/${jobId}`,
      });

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
      {/* AUDIOMORPH_TEST_MODE hook */}
      <span hidden data-testid="route-ready" />
      <header className="px-8 py-6 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">AudioMorph Studio</h1>
      </header>

      <main className="flex-1 flex flex-col items-center p-8 max-w-4xl mx-auto w-full">
        {isLoadingModels ? (
          <div className="py-20 text-[var(--color-text-muted)] animate-pulse">
            Loading studio...
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 border border-dashed border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-2)] w-full text-center">
            <div className="w-16 h-16 bg-[var(--color-surface-3)] rounded-full flex items-center justify-center mb-4 text-2xl">
              📥
            </div>
            <h2 className="text-xl font-semibold mb-2">No models downloaded yet</h2>
            <p className="text-[var(--color-text-muted)] mb-6 max-w-md">
              You need at least one verified model to start generating music. Please go to the
              models page to download one.
            </p>
            <Link
              href="/models"
              className="px-6 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-surface)] font-medium hover:opacity-90 transition-opacity"
            >
              Go to Models
            </Link>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-8">
            <GenerationForm models={models} onSubmit={handleSubmit} onCancel={handleCancel} />

            <div className="w-full max-w-2xl mx-auto flex flex-col">
              <PhaseIndicator />
              <ResultCard />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
