import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getCacheKey,
  loadManifest,
  getCachedModelPath,
  verifyModelManifest,
  type Manifest,
} from './hf-cache';

describe('hf-cache', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `hf-cache-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('getCacheKey', () => {
    it('returns deterministic SHA256 hash', () => {
      const manifest: Manifest = {
        'facebook/musicgen-small': {
          id: 'facebook/musicgen-small',
          revision: '4c8334b02c6ec4e8664a91979669a501ec497792',
          size_mb: 1400,
        },
      };

      const key1 = getCacheKey(manifest);
      const key2 = getCacheKey(manifest);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different keys for different manifests', () => {
      const manifest1: Manifest = {
        'facebook/musicgen-small': {
          id: 'facebook/musicgen-small',
          revision: '4c8334b02c6ec4e8664a91979669a501ec497792',
          size_mb: 1400,
        },
      };

      const manifest2: Manifest = {
        'openai/whisper-tiny': {
          id: 'openai/whisper-tiny',
          revision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
          size_mb: 140,
        },
      };

      expect(getCacheKey(manifest1)).not.toBe(getCacheKey(manifest2));
    });
  });

  describe('loadManifest', () => {
    it('loads manifest from file', () => {
      const manifestPath = join(tmpDir, 'manifest.json');
      const manifestData = [
        {
          id: 'facebook/musicgen-small',
          revision: '4c8334b02c6ec4e8664a91979669a501ec497792',
          size_mb: 1400,
        },
      ];

      writeFileSync(manifestPath, JSON.stringify(manifestData));
      process.env.AUDIOMORPH_MANIFEST_PATH = manifestPath;

      const manifest = loadManifest();

      expect(manifest['facebook/musicgen-small']).toBeDefined();
      expect(manifest['facebook/musicgen-small'].revision).toBe(
        '4c8334b02c6ec4e8664a91979669a501ec497792'
      );

      delete process.env.AUDIOMORPH_MANIFEST_PATH;
    });

    it('throws on missing revision field', () => {
      const manifestPath = join(tmpDir, 'bad-manifest.json');
      const manifestData = [
        {
          id: 'facebook/musicgen-small',
          size_mb: 1400,
          // missing revision
        },
      ];

      writeFileSync(manifestPath, JSON.stringify(manifestData));
      process.env.AUDIOMORPH_MANIFEST_PATH = manifestPath;

      expect(() => loadManifest()).toThrow('missing required fields');

      delete process.env.AUDIOMORPH_MANIFEST_PATH;
    });

    it('throws on invalid revision SHA length', () => {
      const manifestPath = join(tmpDir, 'bad-sha-manifest.json');
      const manifestData = [
        {
          id: 'facebook/musicgen-small',
          revision: 'tooshort',
          size_mb: 1400,
        },
      ];

      writeFileSync(manifestPath, JSON.stringify(manifestData));
      process.env.AUDIOMORPH_MANIFEST_PATH = manifestPath;

      expect(() => loadManifest()).toThrow('expected 40 chars');

      delete process.env.AUDIOMORPH_MANIFEST_PATH;
    });
  });

  describe('getCachedModelPath', () => {
    it('constructs correct cache path', () => {
      process.env.HF_HOME = tmpDir;

      const path = getCachedModelPath('facebook/musicgen-small', '4c8334b02c6ec4e8664a91979669a501ec497792');

      expect(path).toContain('models--facebook--musicgen-small');
      expect(path).toContain('snapshots');
      expect(path).toContain('4c8334b02c6ec4e8664a91979669a501ec497792');

      delete process.env.HF_HOME;
    });

    it('throws on invalid model ID', () => {
      expect(() => getCachedModelPath('invalid-id', 'abc123')).toThrow('Invalid model ID');
    });
  });

  describe('verifyModelManifest', () => {
    it('returns ok=false with missing list when models not found', () => {
      process.env.HF_HOME = tmpDir;

      const manifest: Manifest = {
        'facebook/musicgen-small': {
          id: 'facebook/musicgen-small',
          revision: '4c8334b02c6ec4e8664a91979669a501ec497792',
          size_mb: 1400,
        },
        'openai/whisper-tiny': {
          id: 'openai/whisper-tiny',
          revision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
          size_mb: 140,
        },
      };

      const result = verifyModelManifest(manifest);

      expect(result.ok).toBe(false);
      expect(result.missing).toContain('facebook/musicgen-small');
      expect(result.missing).toContain('openai/whisper-tiny');

      delete process.env.HF_HOME;
    });

    it('returns ok=true when all models exist', () => {
      process.env.HF_HOME = tmpDir;

      const manifest: Manifest = {
        'facebook/musicgen-small': {
          id: 'facebook/musicgen-small',
          revision: '4c8334b02c6ec4e8664a91979669a501ec497792',
          size_mb: 1400,
        },
      };

      // Create the cache directory structure
      const cachePath = getCachedModelPath(
        'facebook/musicgen-small',
        '4c8334b02c6ec4e8664a91979669a501ec497792'
      );
      mkdirSync(cachePath, { recursive: true });

      const result = verifyModelManifest(manifest);

      expect(result.ok).toBe(true);
      expect(result.missing).toBeUndefined();

      delete process.env.HF_HOME;
    });
  });
});
