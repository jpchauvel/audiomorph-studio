'use client';
import { create } from 'zustand';

export type ModelState = 'missing' | 'downloading' | 'verified' | 'partial' | 'corrupted';

export type ModelInfo = {
  id: string;
  repo_id: string;
  name: string;
  size_gb: number;
  state: ModelState;
};

export type DownloadProgress = {
  jobId: string;
  bytesDone: number;
  totalBytes: number;
  speedMbps: number;
  currentFile: string;
  state: 'downloading' | 'done' | 'error' | 'cancelled';
  error?: string;
  errorCode?: string;
};

type ModelsStore = {
  models: ModelInfo[];
  progress: Record<string, DownloadProgress>; // keyed by model.id
  setModels: (m: ModelInfo[]) => void;
  setProgress: (modelId: string, p: Partial<DownloadProgress>) => void;
  clearProgress: (modelId: string) => void;
};

export const useModelsStore = create<ModelsStore>((set) => ({
  models: [],
  progress: {},
  setModels: (models) => set({ models }),
  setProgress: (modelId, p) =>
    set((s) => ({
      progress: { ...s.progress, [modelId]: { ...s.progress[modelId], ...p } as DownloadProgress },
    })),
  clearProgress: (modelId) =>
    set((s) => {
      const p = { ...s.progress };
      delete p[modelId];
      return { progress: p };
    }),
}));
