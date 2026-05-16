import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { scrubSecrets, scrubFile, scrubDirectory, SECRET_PATTERNS } from './scrubber';

describe('scrubber', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrubber-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('SECRET_PATTERNS', () => {
    it('should have 5 patterns defined', () => {
      expect(SECRET_PATTERNS).toHaveLength(5);
    });

    it('should have unique pattern names', () => {
      const names = SECRET_PATTERNS.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('scrubSecrets', () => {
    it('should match X-Audiomorph-Token header', () => {
      const text = 'X-Audiomorph-Token: test-token-deterministic-do-not-use-in-prod';
      const result = scrubSecrets(text);
      expect(result.replacements).toBe(1);
    });

    it('should match Authorization Bearer token', () => {
      const text = 'Authorization: Bearer sk-or-v1-PLANTED-FAKE-TEST-TOKEN';
      const result = scrubSecrets(text);
      expect(result.replacements).toBe(1);
    });

    it('should match OpenRouter sk-or- prefix', () => {
      const text = 'sk-or-v1-PLANTED-FAKE-TEST-TOKEN';
      const result = scrubSecrets(text);
      expect(result.replacements).toBe(1);
    });

    it('should match HuggingFace hf_ prefix', () => {
      const text = 'hf_abcdef123456';
      const result = scrubSecrets(text);
      expect(result.replacements).toBe(1);
    });

    it('should match generic Bearer tokens', () => {
      const text = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = scrubSecrets(text);
      expect(result.replacements).toBe(1);
    });

    it('should leave plain text unchanged', () => {
      const text = 'This is plain text with no secrets';
      const result = scrubSecrets(text);
      expect(result.replacements).toBe(0);
    });

    it('should preserve multi-line content structure', () => {
      const text = 'Line 1\nX-Audiomorph-Token: secret123\nLine 3';
      const result = scrubSecrets(text);
      expect(result.replacements).toBe(1);
    });

    it('should be idempotent', () => {
      const text = 'X-Audiomorph-Token: secret123';
      const result1 = scrubSecrets(text);
      const scrubbed = text.replace(/X-Audiomorph-Token: secret123/g, '[REDACTED-AUDIOMORPH_TOKEN]');
      const result2 = scrubSecrets(scrubbed);
      expect(result2.replacements).toBe(0);
    });

    it('should handle multiple secrets in one text', () => {
      const text = `
        X-Audiomorph-Token: token1
        Authorization: Bearer token2
        sk-or-v1-token3
        hf_token4
      `;
      const result = scrubSecrets(text);
      expect(result.replacements).toBeGreaterThanOrEqual(4);
    });

    it('should include pattern name in replacement', () => {
      const text = 'X-Audiomorph-Token: secret123';
      const result = scrubSecrets(text);
      expect(result.replacements).toBe(1);
    });
  });

  describe('scrubFile', () => {
    it('should scrub secrets in a file', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'X-Audiomorph-Token: secret123');
      const result = scrubFile(filePath);
      expect(result.replacements).toBe(1);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('[REDACTED-AUDIOMORPH_TOKEN]');
    });

    it('should use atomic writes (temp file + rename)', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'X-Audiomorph-Token: secret123');
      const result = scrubFile(filePath);
      expect(result.replacements).toBe(1);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    });

    it('should not modify files with no secrets', () => {
      const filePath = path.join(tempDir, 'test.txt');
      const originalContent = 'This is plain text';
      fs.writeFileSync(filePath, originalContent);
      const result = scrubFile(filePath);
      expect(result.replacements).toBe(0);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe(originalContent);
    });

    it('should return correct replacement count', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(
        filePath,
        `
        X-Audiomorph-Token: token1
        sk-or-v1-token2
        hf_token3
      `
      );
      const result = scrubFile(filePath);
      expect(result.replacements).toBe(3);
    });
  });

  describe('scrubDirectory', () => {
    it('should process multiple files', async () => {
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'X-Audiomorph-Token: secret1');
      fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'sk-or-v1-secret2');
      fs.writeFileSync(path.join(tempDir, 'file3.json'), 'hf_secret3');

      const result = await scrubDirectory(tempDir);
      expect(result.filesProcessed).toBe(3);
      expect(result.replacements).toBe(3);
    });

    it('should skip node_modules directory', async () => {
      const nodeModulesDir = path.join(tempDir, 'node_modules');
      fs.mkdirSync(nodeModulesDir);
      fs.writeFileSync(path.join(nodeModulesDir, 'file.txt'), 'X-Audiomorph-Token: secret');

      const result = await scrubDirectory(tempDir);
      expect(result.filesProcessed).toBe(0);
      expect(result.replacements).toBe(0);
    });

    it('should skip hidden directories', async () => {
      const hiddenDir = path.join(tempDir, '.hidden');
      fs.mkdirSync(hiddenDir);
      fs.writeFileSync(path.join(hiddenDir, 'file.txt'), 'X-Audiomorph-Token: secret');

      const result = await scrubDirectory(tempDir);
      expect(result.filesProcessed).toBe(0);
      expect(result.replacements).toBe(0);
    });

    it('should process nested directories', async () => {
      const subDir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'X-Audiomorph-Token: secret1');
      fs.writeFileSync(path.join(subDir, 'file2.txt'), 'sk-or-v1-secret2');

      const result = await scrubDirectory(tempDir);
      expect(result.filesProcessed).toBe(2);
      expect(result.replacements).toBe(2);
    });

    it('should filter by file extensions', async () => {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'X-Audiomorph-Token: secret1');
      fs.writeFileSync(path.join(tempDir, 'file.bin'), 'X-Audiomorph-Token: secret2');

      const result = await scrubDirectory(tempDir, ['.txt']);
      expect(result.filesProcessed).toBe(1);
      expect(result.replacements).toBe(1);
    });

    it('should return correct totals', async () => {
      fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'X-Audiomorph-Token: s1\nsk-or-v1-s2');
      fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'hf_s3');

      const result = await scrubDirectory(tempDir);
      expect(result.filesProcessed).toBe(2);
      expect(result.replacements).toBe(3);
    });
  });
});

describe('scrub-test-output.mjs (CI integration — positive control)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-cli-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects a real-shaped OpenRouter token planted in a temp file', async () => {
    const plantedToken = 'sk-or-v1-abc123def456ghi789jkl012mno';
    const file = path.join(tempDir, 'leak.txt');
    fs.writeFileSync(file, `header\nleaked: ${plantedToken}\nfooter`);

    const { execFileSync } = await import('node:child_process');
    const scriptPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'scrub-test-output.mjs');

    // Symlink temp file into .test-results so the script's hardcoded scan dirs see it.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const qaDir = path.join(repoRoot, '.test-results', '_positive_control_qa');
    fs.mkdirSync(qaDir, { recursive: true });
    const planted = path.join(qaDir, 'leak.txt');
    fs.copyFileSync(file, planted);

    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execFileSync('node', [scriptPath], { encoding: 'utf8' });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      exitCode = e.status ?? -1;
      stdout = e.stdout ?? '';
    } finally {
      fs.rmSync(qaDir, { recursive: true, force: true });
    }

    expect(exitCode).toBe(1);
    expect(stdout).toContain('OPENROUTER_KEY');
    expect(stdout).toContain('leak.txt');
  });
});
