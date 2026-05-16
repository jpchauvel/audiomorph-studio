import { create } from 'zustand';

interface SettingsState {
  modelsDir: string;
  openrouterKeyPresent: boolean;
  setSettings: (settings: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  modelsDir: '',
  openrouterKeyPresent: false,
  setSettings: (settings) => set((state) => ({ ...state, ...settings })),
}));
