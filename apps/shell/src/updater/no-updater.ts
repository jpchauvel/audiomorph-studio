/* eslint-disable no-console -- user-facing notice for forbidden auto-update channel */
import { autoUpdater } from 'electron';

const DISABLED_MESSAGE = 'Auto-update is disabled in AudioMorph Studio';

type AutoUpdaterNoopResult = {
  readonly updateInfo: null;
  readonly cancellationToken: null;
};

function logDisabled(): void {
  console.warn(DISABLED_MESSAGE);
}

function makeNoop(): Promise<AutoUpdaterNoopResult> {
  logDisabled();
  return Promise.resolve({
    updateInfo: null,
    cancellationToken: null,
  });
}

export function disableAutoUpdater(): void {
  if (!autoUpdater) return;

  const guardedUpdater = autoUpdater as typeof autoUpdater & {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    checkForUpdatesAndNotify: () => Promise<AutoUpdaterNoopResult>;
  };

  guardedUpdater.autoDownload = false;
  guardedUpdater.autoInstallOnAppQuit = false;

  guardedUpdater.checkForUpdates = makeNoop as typeof guardedUpdater.checkForUpdates;
  guardedUpdater.checkForUpdatesAndNotify = makeNoop;

  guardedUpdater.on('update-available', () => {
    logDisabled();
  });
}
