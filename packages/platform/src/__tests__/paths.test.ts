import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPlatform,
  getUserDataDir,
  getModelsDir,
  getLogsDir,
  getCacheDir,
  getDefaultModelsDir,
} from '../index';

describe('Platform paths', () => {
  const originalEnv = process.env.AUDIOMORPH_DATA_DIR;

  afterEach(() => {
    process.env.AUDIOMORPH_DATA_DIR = originalEnv;
  });

  it('getPlatform returns valid platform string', () => {
    const platform = getPlatform();
    expect(['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']).toContain(platform);
  });

  it('getUserDataDir contains Application Support on darwin', () => {
    if (process.platform === 'darwin') {
      const dir = getUserDataDir();
      expect(dir).toContain('Application Support');
    }
  });

  it('getModelsDir is subdirectory of getUserDataDir', () => {
    const userDir = getUserDataDir();
    const modelsDir = getModelsDir();
    expect(modelsDir).toContain(userDir);
    expect(modelsDir).toContain('models');
  });

  it('getLogsDir is subdirectory of getUserDataDir', () => {
    const userDir = getUserDataDir();
    const logsDir = getLogsDir();
    expect(logsDir).toContain(userDir);
    expect(logsDir).toContain('logs');
  });

  it('getCacheDir is subdirectory of getUserDataDir', () => {
    const userDir = getUserDataDir();
    const cacheDir = getCacheDir();
    expect(cacheDir).toContain(userDir);
    expect(cacheDir).toContain('cache');
  });

  it('getDefaultModelsDir equals getModelsDir', () => {
    expect(getDefaultModelsDir()).toBe(getModelsDir());
  });

  it('AUDIOMORPH_DATA_DIR env override works', () => {
    const override = '/tmp/test-audiomorph';
    process.env.AUDIOMORPH_DATA_DIR = override;
    expect(getUserDataDir()).toBe(override);
  });
});
