#!/usr/bin/env node
/**
 * Scrubber CI integration: scans test output directories for leaked secrets.
 *
 * Patterns (security-critical):
 *   - sk-or-v1-[A-Za-z0-9-_]{20,}   (OpenRouter API keys)
 *   - hf_[A-Za-z0-9]{30,}           (HuggingFace tokens)
 *   - Bearer [A-Za-z0-9-._~+/]{20,}={0,2}  (generic bearer tokens)
 *
 * Whitelist: literal substring `PLANTED-FAKE-TEST-TOKEN` is ignored
 * (used by E2E tests for negative-control scenarios).
 *
 * Exit codes: 0=clean, 1=secrets found, 2=script error.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// NOTE: `.sisyphus/` is internal tooling (notepads, evidence, plans) — not CI
// output. Evidence files intentionally contain real-shaped fake tokens as
// documentation, so scanning them produces false positives. Only scan
// genuine CI/test output directories.
const SCAN_DIRS = ['.test-results', 'playwright-report', 'test-results'];

const PATTERNS = [
  { name: 'OPENROUTER_KEY', re: /sk-or-v1-[A-Za-z0-9\-_]{20,}/g },
  { name: 'HUGGINGFACE_TOKEN', re: /hf_[A-Za-z0-9]{30,}/g },
  { name: 'BEARER_TOKEN', re: /Bearer [A-Za-z0-9\-._~+/]{20,}={0,2}/g },
];

const WHITELIST = 'PLANTED-FAKE-TEST-TOKEN';

const BINARY_EXTS = new Set(['.png', '.mp4', '.wav', '.jpg', '.jpeg', '.gif']);

/** Suspicious-looking filenames worth flagging even for binary files. */
function checkBinaryFilename(filePath) {
  const base = path.basename(filePath);
  const matches = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    const m = base.match(re);
    if (m) {
      for (const hit of m) {
        if (hit.includes(WHITELIST)) continue;
        matches.push({ file: filePath, line: 0, pattern: name, snippet: hit });
      }
    }
  }
  return matches;
}

async function scanTextFile(filePath) {
  const matches = [];
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    // Unreadable as utf8 — treat as binary, fall back to filename check
    return checkBinaryFilename(filePath);
  }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      const found = line.match(re);
      if (!found) continue;
      for (const hit of found) {
        if (hit.includes(WHITELIST)) continue;
        matches.push({
          file: filePath,
          line: i + 1,
          pattern: name,
          snippet: hit,
        });
      }
    }
  }
  return matches;
}

async function scanDir(absDir) {
  let entries;
  try {
    entries = await fs.readdir(absDir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Node 20+ exposes parentPath; Node 18 uses .path
    const parent = entry.parentPath ?? entry.path ?? absDir;
    const full = path.join(parent, entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    if (BINARY_EXTS.has(ext)) {
      matches.push(...checkBinaryFilename(full));
    } else {
      matches.push(...(await scanTextFile(full)));
    }
  }
  return matches;
}

async function main() {
  const allMatches = [];
  for (const rel of SCAN_DIRS) {
    const abs = path.join(REPO_ROOT, rel);
    const found = await scanDir(abs);
    allMatches.push(...found);
  }
  if (allMatches.length === 0) {
    console.log('scrub-test-output: clean (0 secrets detected)');
    return 0;
  }
  for (const m of allMatches) {
    const rel = path.relative(REPO_ROOT, m.file);
    console.log(`${rel}:${m.line}:${m.pattern}`);
  }
  console.error(`\nscrub-test-output: FAILED — ${allMatches.length} potential secret(s) detected`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('scrub-test-output: script error:', err?.stack ?? err);
    process.exit(2);
  });
