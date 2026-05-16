import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = resolve(__dirname, '../../../..');
const shellDir = resolve(__dirname, '../..');

function readYml(): string {
  return readFileSync(resolve(shellDir, 'electron-builder.yml'), 'utf8');
}

describe('win packaging', () => {
  beforeEach(() => {
    process.env.AUDIOMORPH_SHELL_TEST = '1';
  });

  it('electron-builder.yml win section has required fields', () => {
    const yml = readYml();
    expect(yml).toMatch(/^win:\s*$/m);
    expect(yml).toMatch(/^\s{2}icon:\s*build\/icon\.ico\s*$/m);
    expect(yml).toMatch(/^\s{2}publisherName:\s*AudioMorph Studio\s*$/m);
    expect(yml).toMatch(/^\s{2}verifyUpdateCodeSignature:\s*false\s*$/m);
    expect(yml).toMatch(/target:\s*nsis/);
    expect(yml).toMatch(/arch:\s*\n\s*-\s*x64/);
  });

  it('electron-builder.yml nsis section has required fields', () => {
    const yml = readYml();
    expect(yml).toMatch(/^nsis:\s*$/m);
    expect(yml).toMatch(/^\s{2}oneClick:\s*false\s*$/m);
    expect(yml).toMatch(/^\s{2}allowToChangeInstallationDirectory:\s*true\s*$/m);
    expect(yml).toMatch(/^\s{2}perMachine:\s*false\s*$/m);
    expect(yml).toMatch(/^\s{2}createDesktopShortcut:\s*true\s*$/m);
    expect(yml).toMatch(/^\s{2}createStartMenuShortcut:\s*true\s*$/m);
    expect(yml).toMatch(/^\s{2}installerIcon:\s*build\/installer\.ico\s*$/m);
    expect(yml).toMatch(/^\s{2}uninstallerIcon:\s*build\/uninstaller\.ico\s*$/m);
    expect(yml).toMatch(/^\s{2}include:\s*build\/installer\.nsh\s*$/m);
  });

  it('installer.nsh contains NVIDIA check via Get-CimInstance (not wmic)', () => {
    const nshPath = resolve(shellDir, 'build/installer.nsh');
    const nsh = readFileSync(nshPath, 'utf8');

    expect(nsh).toContain('Get-CimInstance');
    expect(nsh).toContain('Win32_VideoController');
    expect(nsh).toContain('NVIDIA');
    expect(nsh).toContain('MessageBox');
    expect(nsh).toContain('Abort');
    expect(nsh).not.toMatch(/\bwmic\b/i);
  });

  it('installer.nsh uses customInit macro and PowerShell exec', () => {
    const nshPath = resolve(shellDir, 'build/installer.nsh');
    const nsh = readFileSync(nshPath, 'utf8');

    expect(nsh).toContain('!macro customInit');
    expect(nsh).toContain('!macroend');
    expect(nsh).toMatch(/nsExec::Exec(ToStack|Wait)?|ExecWait/);
    expect(nsh).toContain('powershell');
  });

  it('build-win.sh exists, is executable, and has valid bash syntax', () => {
    const scriptPath = resolve(rootDir, 'scripts/build-win.sh');
    const stat = statSync(scriptPath);

    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o111).not.toBe(0);

    execFileSync('bash', ['-n', scriptPath]);
  });

  it('build-win.sh runs electron-builder --win --x64 and does not require WIN_CSC vars', () => {
    const scriptPath = resolve(rootDir, 'scripts/build-win.sh');
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('electron-builder --win --x64');
    expect(script).toContain('bun run build:all');
    expect(script).not.toMatch(/require_env\s+"WIN_CSC_LINK"/);
    expect(script).not.toMatch(/require_env\s+"WIN_CSC_KEY_PASSWORD"/);
    expect(script).toContain('WIN_CSC_LINK');
    expect(script).toContain('WIN_CSC_KEY_PASSWORD');
  });
});
