/* eslint-disable no-console -- build-time CLI script reports progress to stdout/stderr */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const rootDir = resolve(__dirname, '..');

/**
 * Stamp version across all workspace package.json files and Python pyproject.toml
 * Usage: bun scripts/stamp-version.ts [version]
 * If no version provided, reads from root package.json
 */

function getVersion(): string {
  const rootPkgPath = resolve(rootDir, 'package.json');
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
  return rootPkg.version;
}

function stampVersion(version: string): void {
  const files = [
    // Root
    resolve(rootDir, 'package.json'),
    // Apps
    resolve(rootDir, 'apps/shell/package.json'),
    resolve(rootDir, 'apps/renderer/package.json'),
    // Packages
    resolve(rootDir, 'packages/hardware-gate/package.json'),
    resolve(rootDir, 'packages/ipc-contracts/package.json'),
    resolve(rootDir, 'packages/shared-types/package.json'),
  ];

  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(file, 'utf8'));
      content.version = version;
      writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
      console.log(`✓ ${file}`);
    } catch (err) {
      console.error(`✗ Failed to update ${file}:`, err);
    }
  }

  // Update Python pyproject.toml
  const pyprojectPath = resolve(rootDir, 'apps/sidecar/pyproject.toml');
  try {
    let content = readFileSync(pyprojectPath, 'utf8');
    content = content.replace(/^version = ".*?"$/m, `version = "${version}"`);
    writeFileSync(pyprojectPath, content);
    console.log(`✓ ${pyprojectPath}`);
  } catch (err) {
    console.error(`✗ Failed to update ${pyprojectPath}:`, err);
  }

  // Write version.ts files
  const versionTs = `export const VERSION = "${version}";\n`;

  const rendererVersionPath = resolve(rootDir, 'apps/renderer/src/version.ts');
  try {
    mkdirSync(dirname(rendererVersionPath), { recursive: true });
    writeFileSync(rendererVersionPath, versionTs);
    console.log(`✓ ${rendererVersionPath}`);
  } catch (err) {
    console.error(`✗ Failed to write ${rendererVersionPath}:`, err);
  }

  const shellVersionPath = resolve(rootDir, 'apps/shell/src/version.ts');
  try {
    mkdirSync(dirname(shellVersionPath), { recursive: true });
    writeFileSync(shellVersionPath, versionTs);
    console.log(`✓ ${shellVersionPath}`);
  } catch (err) {
    console.error(`✗ Failed to write ${shellVersionPath}:`, err);
  }
}

const version = process.argv[2] || getVersion();
console.log(`Stamping version: ${version}`);
stampVersion(version);
console.log('Done!');
