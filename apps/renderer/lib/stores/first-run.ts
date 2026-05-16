'use client'
import { create } from 'zustand'

type DownloadJob = {
  jobId: string
  modelId: string
  bytesDone: number
  totalBytes: number
  speedMbps: number
  currentFile: string
  state: 'idle' | 'downloading' | 'done' | 'error' | 'cancelled'
  error?: string
}

type FirstRunStore = {
  step: 1 | 2 | 3 | 4
  modelsDir: string
  freeDiskGb: number | null
  downloadJobs: Record<string, DownloadJob>
  setStep: (s: 1 | 2 | 3 | 4) => void
  setModelsDir: (dir: string, freeGb: number) => void
  setDownloadJob: (modelId: string, job: Partial<DownloadJob>) => void
  reset: () => void
}

export const useFirstRunStore = create<FirstRunStore>((set) => ({
  step: 1,
  modelsDir: '',
  freeDiskGb: null,
  downloadJobs: {},
  setStep: (step) => set({ step }),
  setModelsDir: (modelsDir, freeDiskGb) => set({ modelsDir, freeDiskGb }),
  setDownloadJob: (modelId, job) =>
    set((s) => ({
      downloadJobs: {
        ...s.downloadJobs,
        [modelId]: { ...s.downloadJobs[modelId], modelId, ...job } as DownloadJob,
      },
    })),
  reset: () => set({ step: 1, modelsDir: '', freeDiskGb: null, downloadJobs: {} }),
}))