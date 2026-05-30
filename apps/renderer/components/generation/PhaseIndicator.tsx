'use client';

import { useEffect, useRef, useState } from 'react';
import { useGenerationStore, GenPhase } from '@/lib/stores/generation';
import { cn } from '@/lib/utils';

type PhaseEntry = {
  id: Extract<GenPhase, 'loading' | 'generating' | 'encoding' | 'finalizing'>;
  label: string;
};

const PHASES: PhaseEntry[] = [
  { id: 'loading', label: 'Preparing' },
  { id: 'generating', label: 'Generating' },
  { id: 'encoding', label: 'Encoding' },
  { id: 'finalizing', label: 'Finalizing' },
];

const MIN_PHASE_MS = 500;

function phaseRank(p: GenPhase): number {
  const idx = PHASES.findIndex((entry) => entry.id === p);
  if (idx >= 0) return idx;
  if (p === 'idle') return -1;
  return PHASES.length;
}

function useDisplayPhase(actual: GenPhase): GenPhase {
  const [displayed, setDisplayed] = useState<GenPhase>(actual);
  const queueRef = useRef<GenPhase[]>([]);
  const lastShownAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tryAdvance = () => {
      const next = queueRef.current.shift();
      if (next === undefined) {
        timerRef.current = null;
        return;
      }
      setDisplayed(next);
      lastShownAtRef.current = Date.now();
      timerRef.current = queueRef.current.length > 0 ? setTimeout(tryAdvance, MIN_PHASE_MS) : null;
    };

    const targetRank = phaseRank(actual);
    const displayedRank = phaseRank(displayed);

    if (actual === displayed && queueRef.current.length === 0) return;
    if (actual === displayed && timerRef.current !== null) return;

    if (targetRank < displayedRank) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      queueRef.current = [];
      if (actual !== displayed) {
        setDisplayed(actual);
        lastShownAtRef.current = Date.now();
      }
      return;
    }

    const intermediate: GenPhase[] = [];
    const fromIdx = Math.max(0, displayedRank + 1);
    const toIdx = Math.min(PHASES.length, targetRank);
    for (let i = fromIdx; i < toIdx; i += 1) {
      const entry = PHASES[i];
      if (entry) intermediate.push(entry.id);
    }
    if (actual !== displayed) intermediate.push(actual);
    queueRef.current = intermediate;

    if (timerRef.current) return;

    const elapsed = Date.now() - lastShownAtRef.current;
    if (elapsed >= MIN_PHASE_MS || displayed === 'idle') {
      tryAdvance();
    } else {
      timerRef.current = setTimeout(tryAdvance, MIN_PHASE_MS - elapsed);
    }
  }, [actual, displayed]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return displayed;
}

export function PhaseIndicator() {
  const { phase, step, totalSteps, etaS, errorMsg } = useGenerationStore();
  const displayPhase = useDisplayPhase(phase);

  if (displayPhase === 'idle') return null;

  if (displayPhase === 'error') {
    return (
      <div
        data-testid="phase-indicator-error"
        className="p-4 rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-sm"
      >
        <span className="font-semibold">Error:</span> {errorMsg}
      </div>
    );
  }

  if (displayPhase === 'cancelled') {
    return (
      <div
        data-testid="phase-indicator-cancelled"
        className="p-4 rounded-xl border border-[var(--color-warning)] bg-[var(--color-warning)]/10 text-[var(--color-warning)] text-sm"
      >
        Generation cancelled.
      </div>
    );
  }

  if (displayPhase === 'done') return null;

  const activeIdx = PHASES.findIndex((p) => p.id === displayPhase);
  const progressPct = Math.max(0, (activeIdx / (PHASES.length - 1)) * 100);

  return (
    <div
      data-testid="phase-indicator"
      data-phase={displayPhase}
      className="w-full flex flex-col gap-4 mt-6 p-6 rounded-2xl bg-[var(--color-surface-2)] border border-[var(--color-border)]"
    >
      <div className="flex justify-between items-start w-full relative">
        <div className="absolute top-4 left-4 right-4 h-[3px] bg-[var(--color-surface-3)] rounded-full overflow-hidden z-0">
          <div
            className="h-full bg-gradient-to-r from-[var(--color-primary)] via-[var(--color-primary)] to-[var(--color-success)] transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {PHASES.map((p, i) => {
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;

          return (
            <div
              key={p.id}
              data-testid={`phase-step-${p.id}`}
              data-active={isActive ? 'true' : 'false'}
              data-past={isPast ? 'true' : 'false'}
              className="flex flex-col items-center gap-2 z-10"
            >
              <div className="relative w-8 h-8">
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-[var(--color-primary)] opacity-40 animate-ping"
                  />
                )}
                <div
                  className={cn(
                    'relative w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all duration-300',
                    isActive &&
                      'bg-[var(--color-primary)] text-[var(--color-surface)] border-[var(--color-primary)] scale-110 shadow-[0_0_18px_var(--color-primary)]',
                    isPast &&
                      'bg-[var(--color-success)] text-[var(--color-surface)] border-[var(--color-success)] shadow-[0_0_10px_var(--color-success)]',
                    !isActive &&
                      !isPast &&
                      'bg-[var(--color-surface-3)] text-[var(--color-text-muted)] border-[var(--color-border)]',
                  )}
                >
                  {isPast ? '✓' : i + 1}
                </div>
              </div>
              <span
                className={cn(
                  'text-xs font-medium transition-colors duration-300',
                  isActive && 'text-[var(--color-primary)] font-semibold',
                  isPast && 'text-[var(--color-success)]',
                  !isActive && !isPast && 'text-[var(--color-text-muted)]',
                )}
              >
                {p.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-xs text-[var(--color-text-muted)] px-1 mt-2">
        <span>
          {displayPhase === 'generating' && totalSteps > 0
            ? `Step ${step} of ${totalSteps}`
            : 'Please wait...'}
        </span>
        <span>{etaS !== null && etaS > 0 ? `~${Math.ceil(etaS)}s remaining` : ''}</span>
      </div>
    </div>
  );
}
