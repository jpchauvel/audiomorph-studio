'use client';
import { create } from 'zustand';

export type GenPhase =
  | 'idle'
  | 'loading'
  | 'generating'
  | 'encoding'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';

type GenerationStore = {
  jobId: string | null;
  phase: GenPhase;
  step: number;
  totalSteps: number;
  etaS: number | null;
  errorMsg: string | null;
  resultJobId: string | null;
  completedJobIds: string[];
  numSongsTotal: number;
  numSongsDone: number;
  promptDraft: string;
  lyricsDraft: string;
  setJob: (jobId: string) => void;
  setPhase: (phase: GenPhase, step?: number, totalSteps?: number, etaS?: number | null) => void;
  setError: (msg: string) => void;
  setResult: (jobId: string) => void;
  pushCompleted: (jobId: string) => void;
  setBatch: (total: number) => void;
  setPromptDraft: (v: string) => void;
  setLyricsDraft: (v: string) => void;
  clearRun: () => void;
  reset: () => void;
};

export const useGenerationStore = create<GenerationStore>((set) => ({
  jobId: null,
  phase: 'idle',
  step: 0,
  totalSteps: 0,
  etaS: null,
  errorMsg: null,
  resultJobId: null,
  completedJobIds: [],
  numSongsTotal: 1,
  numSongsDone: 0,
  promptDraft: '',
  lyricsDraft: '',
  setJob: (jobId) =>
    set({
      jobId,
      phase: 'loading',
      step: 0,
      totalSteps: 0,
      etaS: null,
      errorMsg: null,
      resultJobId: null,
    }),
  setPhase: (phase, step = 0, totalSteps = 0, etaS = null) =>
    set({ phase, step, totalSteps, etaS }),
  setError: (errorMsg) => set({ phase: 'error', errorMsg }),
  setResult: (resultJobId) => set({ phase: 'done', resultJobId }),
  pushCompleted: (jobId) =>
    set((s) => ({
      completedJobIds: [...s.completedJobIds, jobId],
      numSongsDone: s.numSongsDone + 1,
    })),
  setBatch: (numSongsTotal) => set({ numSongsTotal, numSongsDone: 0, completedJobIds: [] }),
  setPromptDraft: (promptDraft) => set({ promptDraft }),
  setLyricsDraft: (lyricsDraft) => set({ lyricsDraft }),
  clearRun: () =>
    set({
      jobId: null,
      phase: 'idle',
      step: 0,
      totalSteps: 0,
      etaS: null,
      errorMsg: null,
      resultJobId: null,
      completedJobIds: [],
      numSongsDone: 0,
    }),
  reset: () =>
    set({
      jobId: null,
      phase: 'idle',
      step: 0,
      totalSteps: 0,
      etaS: null,
      errorMsg: null,
      resultJobId: null,
      completedJobIds: [],
      numSongsTotal: 1,
      numSongsDone: 0,
      promptDraft: '',
      lyricsDraft: '',
    }),
}));
