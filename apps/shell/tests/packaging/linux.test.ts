import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = resolve(__dirname, '../../../..');
const shellDir = resolve(__dirname, '../..');

function readYml(): string {
  return readFileSync(resolve(shellDir, 'electron-builder.yml'), 'utf8');
}

describe('linux packaging', () => {
  beforeEach(() => {
    process.env.AUDIOMORPH_SHELL_TEST = '1';
  });

  it('electron-builder.yml linux section has required fields', () => {
    const yml = readYml();
    expect(yml).toMatch(/^linux:\s*$/m);
    expect(yml).toMatch(/^\s{2}category:\s*AudioVideo\s*$/m);
    expect(yml).toMatch(/^\s{2}synopsis:\s*AI music generation studio\s*$/m);
    expect(yml).toMatch(/^\s{2}description:\s*Local AI music generation powered by heartlib\s*$/m);
    expect(yml).toMatch(/^\s{2}icon:\s*build\/icons\/\s*$/m);
    expect(yml).toMatch(/target:\s*AppImage/);
    expect(yml).toMatch(/target:\s*deb/);
  });

  it('electron-builder.yml linux desktop entry has required keys', () => {
    const yml = readYml();
    expect(yml).toMatch(/^\s{2}desktop:\s*$/m);
    expect(yml).toMatch(/^\s{4}Name:\s*AudioMorph Studio\s*$/m);
    expect(yml).toMatch(/^\s{4}Comment:\s*AI music generation\s*$/m);
    expect(yml).toMatch(/^\s{4}Categories:\s*AudioVideo;Audio;Music;\s*$/m);
  });

  it('electron-builder.yml deb section lists all required runtime deps', () => {
    const yml = readYml();
    expect(yml).toMatch(/^deb:\s*$/m);
    const required = [
      'libnotify4',
      'libsecret-1-0',
      'libnss3',
      'libxss1',
      'libgtk-3-0',
      'libatk-bridge2.0-0',
      'libgbm1',
    ];
    for (const dep of required) {
      expect(yml).toMatch(
        new RegExp(`^\\s{4}-\\s*${dep.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`, 'm'),
      );
    }
  });

  it('electron-builder.yml deb section wires postinst.sh afterInstall hook', () => {
    const yml = readYml();
    expect(yml).toMatch(/^\s{2}afterInstall:\s*build\/postinst\.sh\s*$/m);
  });

  it('postinst.sh exists, has bash shebang, and uses strict mode', () => {
    const path = resolve(shellDir, 'build/postinst.sh');
    const script = readFileSync(path, 'utf8');
    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(script).toContain('set -euo pipefail');
  });

  it('postinst.sh contains nvidia-smi check with all fallback paths', () => {
    const path = resolve(shellDir, 'build/postinst.sh');
    const script = readFileSync(path, 'utf8');
    expect(script).toMatch(/command -v nvidia-smi/);
    expect(script).toContain('/usr/bin/nvidia-smi');
    expect(script).toContain('/usr/local/bin/nvidia-smi');
  });

  it('postinst.sh prints red error and exits 1 when nvidia-smi missing', () => {
    const path = resolve(shellDir, 'build/postinst.sh');
    const script = readFileSync(path, 'utf8');
    expect(script).toContain('NVIDIA GPU required for AudioMorph Studio');
    expect(script).toContain('\\033[0;31m');
    expect(script).toMatch(/exit 1/);
    expect(script).toContain('>&2');
  });

  it('postinst.sh has valid bash syntax', () => {
    const path = resolve(shellDir, 'build/postinst.sh');
    execFileSync('bash', ['-n', path]);
  });

  it('build-linux.sh exists, is executable, and has valid bash syntax', () => {
    const scriptPath = resolve(rootDir, 'scripts/build-linux.sh');
    const stat = statSync(scriptPath);

    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o111).not.toBe(0);

    execFileSync('bash', ['-n', scriptPath]);
  });

  it('build-linux.sh runs bun build:all and electron-builder --linux --x64', () => {
    const scriptPath = resolve(rootDir, 'scripts/build-linux.sh');
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('bun run build:all');
    expect(script).toContain('electron-builder --linux --x64');
    expect(script).toContain('set -euo pipefail');
  });
});
