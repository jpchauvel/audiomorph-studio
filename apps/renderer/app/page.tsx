'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useGenerationStore, GenPhase } from '@/lib/stores/generation';
import { GenerationForm } from '@/components/generation/GenerationForm';
import { PhaseIndicator } from '@/components/generation/PhaseIndicator';
import { ResultCard } from '@/components/generation/ResultCard';

const API_BASE = () =>
  (typeof window !== 'undefined' && (window as any).__AUDIOMORPH_API_BASE__) ||
  'http://localhost:8000';
const TOKEN = () => (typeof window !== 'undefined' && (window as any).__AUDIOMORPH_TOKEN__) || '';

const headers = () => ({ 'X-Audiomorph-Token': TOKEN(), 'Content-Type': 'application/json' });

type Model = {
  id: string;
  name: string;
  state: string;
};

export default function StudioPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  const { jobId, phase, setJob, setPhase, setError, setResult, reset } = useGenerationStore();

  useEffect(() => {
    fetch(`${API_BASE()}/models`, { headers: { 'X-Audiomorph-Token': TOKEN() } })
      .then((r) => r.json())
      .then((data: Model[]) => {
        setModels(data.filter((m) => m.state === 'verified'));
      })
      .catch(() => {
        toast.error('Failed to load models');
      })
      .finally(() => {
        setIsLoadingModels(false);
      });

    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
    };
  }, []);

  const handleSubmit = async (data: any) => {
    if (phase !== 'idle' && phase !== 'done' && phase !== 'error' && phase !== 'cancelled') {
      toast.error('Generation already in progress');
      return;
    }

    try {
      reset();
      const res = await fetch(`${API_BASE()}/jobs/generate`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(data),
      });

      if (res.status === 429) {
        toast.error('Too many requests. A generation is already in flight.');
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to start generation');
      }

      const { job_id } = await res.json();
      setJob(job_id);

      const es = new EventSource(`${API_BASE()}/jobs/${job_id}/events`);
      esRef.current = es;

      es.addEventListener('progress', (e) => {
        const d = JSON.parse(e.data);
        setPhase(d.phase as GenPhase, d.step, d.total_steps, d.eta_s);
      });

      es.addEventListener('done', (_e) => {
        setResult(job_id);
        es.close();
        esRef.current = null;
      });

      es.addEventListener('error', (e: any) => {
        const msg = e.data ? JSON.parse(e.data).message : 'Generation failed';
        setError(msg);
        toast.error(`Error: ${msg}`);
        es.close();
        esRef.current = null;
      });

      es.addEventListener('cancelled', () => {
        setPhase('cancelled');
        toast.info('Generation cancelled');
        es.close();
        esRef.current = null;
      });
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;

    try {
      await fetch(`${API_BASE()}/jobs/${jobId}`, {
        method: 'DELETE',
        headers: { 'X-Audiomorph-Token': TOKEN() },
      });

      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
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
