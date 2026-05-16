import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

export type Platform = 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'linux-x64';

export function getPlatform(): Platform {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    if (arch === 'arm64') return 'darwin-arm64';
    return 'darwin-x64';
  }
  if (platform === 'win32') return 'win32-x64';
  if (platform === 'linux') return 'linux-x64';

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

export function getAppName(): string {
  return 'AudioMorph Studio';
}

export function getUserDataDir(): string {
  const override = process.env.AUDIOMORPH_DATA_DIR;
  if (override) {
    return override;
  }

  const platform = process.platform;
  const appName = getAppName();

  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName);
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, appName);
  }

  // Linux and others
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdgConfig, 'audiomorph-studio');
}

export function getModelsDir(): string {
  return join(getUserDataDir(), 'models');
}

export function getLogsDir(): string {
  return join(getUserDataDir(), 'logs');
}

export function getCacheDir(): string {
  return join(getUserDataDir(), 'cache');
}

export function getDefaultModelsDir(): string {
  return getModelsDir();
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}
