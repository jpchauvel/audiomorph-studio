#!/usr/bin/env node
/**
 * Prints a deterministic cache key derived from the HuggingFace model
 * manifest (`apps/sidecar/scripts/required-models.json`). Used by CI as the
 * cache key for restoring/saving the `~/.cache/huggingface` directory.
 *
 * Format: `hf-models-v1-<sha256[:16]>` — stable across runs as long as the
 * manifest content is byte-identical.
 *
 * Honors `AUDIOMORPH_MANIFEST_PATH` for overrides (matches hf-cache.ts).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import { createHash } from 'node:crypto';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'apps', 'sidecar', 'scripts', 'required-models.json');

async function main() {
  const manifestPath = process.env.AUDIOMORPH_MANIFEST_PATH || DEFAULT_MANIFEST;
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (err) {
    console.error(`ci-hf-cache-key: cannot read manifest at ${manifestPath}: ${err.message}`);
    process.exit(2);
  }
  // Re-serialize with sorted keys for stability against whitespace drift.
  const parsed = JSON.parse(raw);
  const canonical = JSON.stringify(parsed, Object.keys(parsed).sort());
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  process.stdout.write(`hf-models-v1-${hash}\n`);
}

main().catch((err) => {
  console.error(`ci-hf-cache-key: unexpected error: ${err?.stack ?? err}`);
  process.exit(2);
});
