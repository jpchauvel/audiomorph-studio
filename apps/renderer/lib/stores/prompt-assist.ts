'use client';
import { create } from 'zustand';

type PromptAssistStore = {
  open: boolean;
  messages: { role: 'user' | 'assistant'; content: string }[];
  streaming: boolean;
  streamBuffer: string;
  model: string;
  setOpen: (v: boolean) => void;
  addMessage: (msg: { role: 'user' | 'assistant'; content: string }) => void;
  appendStream: (chunk: string) => void;
  finalizeStream: () => void;
  setModel: (m: string) => void;
  reset: () => void;
};

export const usePromptAssistStore = create<PromptAssistStore>((set) => ({
  open: false,
  messages: [],
  streaming: false,
  streamBuffer: '',
  model: 'anthropic/claude-3.5-sonnet',
  setOpen: (open) => set({ open }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendStream: (chunk) => set((s) => ({ streamBuffer: s.streamBuffer + chunk, streaming: true })),
  finalizeStream: () =>
    set((s) => ({
      messages: [...s.messages, { role: 'assistant', content: s.streamBuffer }],
      streamBuffer: '',
      streaming: false,
    })),
  setModel: (model) => set({ model }),
  reset: () =>
    set({
      open: false,
      messages: [],
      streaming: false,
      streamBuffer: '',
      model: 'anthropic/claude-3.5-sonnet',
    }),
}));
