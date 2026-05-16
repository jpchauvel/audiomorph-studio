#!/usr/bin/env node
/**
 * Verifies that every model in the HuggingFace manifest
 * (`apps/sidecar/scripts/required-models.json`) is present in the local
 * HuggingFace cache at the pinned revision. Used by CI to confirm a cache
 * hit was complete before running tests that depend on these weights.
 *
 * Exits 0 if all snapshot directories exist; 1 with a list of missing
 * model IDs otherwise. Never throws — uncaught errors map to exit 2.
 *
 * Honors `HF_HOME` (defaults to `~/.cache/huggingface`) and
 * `AUDIOMORPH_MANIFEST_PATH`.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as process from "node:process";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  ".."
);
const DEFAULT_MANIFEST = path.join(
  REPO_ROOT,
  "apps",
  "sidecar",
  "scripts",
  "required-models.json"
);

function snapshotPath(hfHome, id, revision) {
  const [org, name] = id.split("/");
  if (!org || !name) {
    throw new Error(`invalid model id (expected org/name): ${id}`);
  }
  return path.join(hfHome, "hub", `models--${org}--${name}`, "snapshots", revision);
}

async function isDir(p) {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const manifestPath = process.env.AUDIOMORPH_MANIFEST_PATH || DEFAULT_MANIFEST;
  const hfHome = process.env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface");

  let entries;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    entries = JSON.parse(raw);
  } catch (err) {
    console.error(`ci-hf-cache-verify: cannot read manifest at ${manifestPath}: ${err.message}`);
    return 1;
  }
  if (!Array.isArray(entries)) {
    console.error("ci-hf-cache-verify: manifest must be a JSON array of {id, revision, size_mb}");
    return 1;
  }

  const missing = [];
  const present = [];
  for (const entry of entries) {
    if (!entry?.id || !entry?.revision) {
      console.error(`ci-hf-cache-verify: skipping malformed entry: ${JSON.stringify(entry)}`);
      missing.push(entry?.id ?? "<unknown>");
      continue;
    }
    const dir = snapshotPath(hfHome, entry.id, entry.revision);
    if (await isDir(dir)) {
      present.push({ id: entry.id, revision: entry.revision });
    } else {
      missing.push(`${entry.id}@${entry.revision} (expected at ${dir})`);
    }
  }

  if (missing.length === 0) {
    console.log(`ci-hf-cache-verify: OK — ${present.length} model(s) cached at ${hfHome}`);
    for (const p of present) {
      console.log(`  ✓ ${p.id}@${p.revision}`);
    }
    return 0;
  }

  console.error(`ci-hf-cache-verify: MISSING — ${missing.length} of ${entries.length} model(s) not cached at ${hfHome}`);
  for (const m of missing) {
    console.error(`  ✗ ${m}`);
  }
  console.error(`\nHint: run \`pnpm test:hf:warm\` to populate the cache before re-running tests.`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`ci-hf-cache-verify: unexpected error: ${err?.stack ?? err}`);
    process.exit(2);
  });
