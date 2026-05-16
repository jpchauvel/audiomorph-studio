'use client'
import { create } from 'zustand'

export type GenPhase = 'idle' | 'loading' | 'generating' | 'encoding' | 'finalizing' | 'done' | 'error' | 'cancelled'

type GenerationStore = {
  jobId: string | null
  phase: GenPhase
  step: number
  totalSteps: number
  etaS: number | null
  errorMsg: string | null
  resultJobId: string | null
  promptDraft: string
  lyricsDraft: string
  setJob: (jobId: string) => void
  setPhase: (phase: GenPhase, step?: number, totalSteps?: number, etaS?: number | null) => void
  setError: (msg: string) => void
  setResult: (jobId: string) => void
  setPromptDraft: (v: string) => void
  setLyricsDraft: (v: string) => void
  reset: () => void
}

export const useGenerationStore = create<GenerationStore>((set) => ({
  jobId: null,
  phase: 'idle',
  step: 0,
  totalSteps: 0,
  etaS: null,
  errorMsg: null,
  resultJobId: null,
  promptDraft: '',
  lyricsDraft: '',
  setJob: (jobId) => set({ jobId, phase: 'loading', step: 0, totalSteps: 0, etaS: null, errorMsg: null, resultJobId: null }),
  setPhase: (phase, step = 0, totalSteps = 0, etaS = null) => set({ phase, step, totalSteps, etaS }),
  setError: (errorMsg) => set({ phase: 'error', errorMsg }),
  setResult: (resultJobId) => set({ phase: 'done', resultJobId }),
  setPromptDraft: (promptDraft) => set({ promptDraft }),
  setLyricsDraft: (lyricsDraft) => set({ lyricsDraft }),
  reset: () => set({ jobId: null, phase: 'idle', step: 0, totalSteps: 0, etaS: null, errorMsg: null, resultJobId: null, promptDraft: '', lyricsDraft: '' }),
}))
