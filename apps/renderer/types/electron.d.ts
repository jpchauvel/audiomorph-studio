import type { ElectronAPI } from '@audiomorph/ipc-contracts';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
