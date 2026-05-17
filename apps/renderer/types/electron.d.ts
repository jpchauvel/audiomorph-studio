import type { ElectronAPI } from '@audiomorph/ipc-contracts';

// Renderer-side Window augmentations.
// - electronAPI: preload-injected production IPC surface.
// - __AUDIOMORPH_*: test-only globals injected via Playwright addInitScript or
//   the AUDIOMORPH_TEST_MODE preload hook (apps/shell/src/preload.ts).
// - __AUDIOMORPH_IPC__: legacy test-only IPC shim still consumed by first-run
//   wizard for getDiskFreeGb / openDirectory / showItemInFolder. Tracked under
//   TODO(disk-free) to migrate fully to electronAPI.
interface AudiomorphTestIpc {
  openDirectory?: (...args: unknown[]) => Promise<string | { dirPath?: string }>;
  getDiskFreeGb?: (dir: string) => Promise<number>;
  showItemInFolder?: (path: string) => void;
  setOpenRouterKey?: (key: string) => Promise<void>;
  setHfToken?: (token: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __AUDIOMORPH_TEST_MODE__?: boolean;
    __AUDIOMORPH_API_BASE__?: string;
    __AUDIOMORPH_TOKEN__?: string;
    __AUDIOMORPH_VERSION__?: string;
    __AUDIOMORPH_OPENROUTER_KEY__?: string;
    __AUDIOMORPH_IPC__?: AudiomorphTestIpc;
    folderOpenedPath?: string | null;
  }
}

export {};
