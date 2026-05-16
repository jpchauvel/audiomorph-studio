import { describe, it, expect, afterEach } from 'vitest';
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

  it('getUserDataDir on darwin contains Application Support', () => {
    if (process.platform === 'darwin') {
      const dir = getUserDataDir();
      expect(dir).toBeTruthy();
      expect(dir).toMatch(/Application Support/);
    }
  });

  it('getModelsDir is subdirectory of getUserDataDir', () => {
    const userDir = getUserDataDir();
    const modelsDir = getModelsDir();
    expect(modelsDir).toMatch(new RegExp(userDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(modelsDir).toMatch(/models/);
  });

  it('getLogsDir is subdirectory of getUserDataDir', () => {
    const userDir = getUserDataDir();
    const logsDir = getLogsDir();
    expect(logsDir).toMatch(new RegExp(userDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(logsDir).toMatch(/logs/);
  });

  it('getCacheDir is subdirectory of getUserDataDir', () => {
    const userDir = getUserDataDir();
    const cacheDir = getCacheDir();
    expect(cacheDir).toMatch(new RegExp(userDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(cacheDir).toMatch(/cache/);
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
