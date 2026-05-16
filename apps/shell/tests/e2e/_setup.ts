/**
 * E2E setup helper: launches the real AudioMorph Electron shell with sidecar.
 *
 * Returns the Playwright Electron app handle, first window, and sidecar
 * connection info (port + token from test-mode IPC). Caller must invoke
 * teardown() to release resources.
 */
import {
  launchElectronApp,
  type ElectronApplicationLike,
  type PageLike,
} from '@audiomorph/test-helpers/electron';

export interface AudiomorphE2EHandle {
  app: ElectronApplicationLike;
  window: PageLike;
  sidecar: {
    port: number;
    token: string;
    baseUrl: string;
  };
  teardown: () => Promise<void>;
}

export async function launchAudiomorph(
  extraEnv: Record<string, string> = {},
): Promise<AudiomorphE2EHandle> {
  const handle = await launchElectronApp({
    extraEnv: {
      AUDIOMORPH_TEST_MODE: '1',
      ...extraEnv,
    },
  });

  return {
    app: handle.app,
    window: handle.firstWindow,
    sidecar: {
      port: handle.sidecarPort,
      token: handle.sidecarToken,
      baseUrl: `http://127.0.0.1:${handle.sidecarPort}`,
    },
    teardown: () => handle.close(),
  };
}
