'use client';

import { useGenerationStore, GenPhase } from '@/lib/stores/generation';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { cn } from '@/lib/utils';
import { useRef } from 'react';

const PHASES: { id: GenPhase; label: string }[] = [
  { id: 'loading', label: 'Preparing' },
  { id: 'generating', label: 'Generating' },
  { id: 'encoding', label: 'Encoding' },
  { id: 'finalizing', label: 'Finalizing' },
];

export function PhaseIndicator() {
  const { phase, step, totalSteps, etaS, errorMsg } = useGenerationStore();
  const containerRef = useRef<HTMLDivElement>(null);

  if (phase === 'idle') return null;

  if (phase === 'error') {
    return (
      <div className="p-4 rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm">
        <span className="font-semibold">Error:</span> {errorMsg}
      </div>
    );
  }

  if (phase === 'cancelled') {
    return (
      <div className="p-4 rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning)]/10 text-[var(--color-warning)] text-sm">
        Generation cancelled.
      </div>
    );
  }

  if (phase === 'done') return null;

  const activeIdx = PHASES.findIndex((p) => p.id === phase);

  return (
    <div
      className="w-full flex flex-col gap-4 mt-6 p-6 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]"
      ref={containerRef}
    >
      <div className="flex justify-between items-center w-full relative">
        {PHASES.map((p, i) => {
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;

          return (
            <div key={p.id} className="flex flex-col items-center gap-2 z-10">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors border',
                  isActive
                    ? 'bg-[var(--color-primary)] text-[var(--color-surface)] border-[var(--color-primary)] shadow-[0_0_15px_var(--color-primary)]'
                    : isPast
                      ? 'bg-[var(--color-success)] text-[var(--color-surface)] border-[var(--color-success)]'
                      : 'bg-[var(--color-surface-3)] text-[var(--color-text-muted)] border-[var(--color-border)]',
                )}
              >
                {isPast ? '✓' : i + 1}
              </div>
              <span
                className={cn(
                  'text-xs font-medium',
                  isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]',
                )}
              >
                {p.label}
              </span>
            </div>
          );
        })}

        <div className="absolute top-4 left-4 right-4 h-[2px] bg-[var(--color-surface-3)] -z-0">
          <div
            className="h-full bg-[var(--color-primary)] transition-all duration-500 ease-in-out"
            style={{ width: `${Math.max(0, (activeIdx / (PHASES.length - 1)) * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex justify-between text-xs text-[var(--color-text-muted)] px-1 mt-2">
        <span>
          {phase === 'generating' && totalSteps > 0
            ? `Step ${step} of ${totalSteps}`
            : 'Please wait...'}
        </span>
        <span>{etaS !== null && etaS > 0 ? `~${Math.ceil(etaS)}s remaining` : ''}</span>
      </div>

      <AnimatedBeam className="w-full h-2 mt-2 opacity-50" />
    </div>
  );
}
