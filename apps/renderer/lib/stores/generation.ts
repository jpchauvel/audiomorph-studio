import { create } from 'zustand';

interface GenerationState {
  jobId: string | null;
  status: 'idle' | 'generating' | 'completed' | 'error';
  setJob: (jobId: string, status: 'idle' | 'generating' | 'completed' | 'error') => void;
  reset: () => void;
}

export const useGenerationStore = create<GenerationState>((set) => ({
  jobId: null,
  status: 'idle',
  setJob: (jobId, status) => set({ jobId, status }),
  reset: () => set({ jobId: null, status: 'idle' }),
}));
