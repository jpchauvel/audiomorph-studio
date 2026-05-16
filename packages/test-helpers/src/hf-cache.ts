import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export interface ManifestEntry {
  id: string;
  revision: string;
  size_mb: number;
}

export interface Manifest {
  [key: string]: ManifestEntry;
}

export interface VerifyResult {
  ok: boolean;
  missing?: string[];
}

/**
 * Get the cache key for a manifest (SHA256 of JSON content)
 */
export function getCacheKey(manifest: Manifest): string {
  const json = JSON.stringify(manifest, Object.keys(manifest).sort());
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Load manifest from file (supports AUDIOMORPH_MANIFEST_PATH env var)
 */
export function loadManifest(): Manifest {
  const manifestPath = process.env.AUDIOMORPH_MANIFEST_PATH || 
    resolve(join(homedir(), '..', 'apps', 'sidecar', 'scripts', 'required-models.json'));
  
  const content = readFileSync(manifestPath, 'utf-8');
  const entries = JSON.parse(content) as ManifestEntry[];
  
  // Validate schema
  for (const entry of entries) {
    if (!entry.id || !entry.revision || entry.size_mb === undefined) {
      throw new Error(`Invalid manifest entry: missing required fields in ${JSON.stringify(entry)}`);
    }
    if (entry.revision.length !== 40) {
      throw new Error(`Invalid revision SHA for ${entry.id}: expected 40 chars, got ${entry.revision.length}`);
    }
  }
  
  // Convert array to object keyed by id
  const manifest: Manifest = {};
  for (const entry of entries) {
    manifest[entry.id] = entry;
  }
  
  return manifest;
}

/**
 * Get cached model path (supports HF_HOME env var)
 */
export function getCachedModelPath(id: string, revision: string): string {
  const hfHome = process.env.HF_HOME || join(homedir(), '.cache', 'huggingface');
  const [org, name] = id.split('/');
  
  if (!org || !name) {
    throw new Error(`Invalid model ID: ${id}`);
  }
  
  return join(hfHome, 'hub', `models--${org}--${name}`, 'snapshots', revision);
}

/**
 * Verify manifest entries exist in cache (filesystem-only check)
 */
export function verifyModelManifest(manifest: Manifest): VerifyResult {
  const missing: string[] = [];
  
  for (const [id, entry] of Object.entries(manifest)) {
    const cachePath = getCachedModelPath(id, entry.revision);
    
    try {
      const stat = statSync(cachePath);
      if (!stat.isDirectory()) {
        missing.push(id);
      }
    } catch {
      missing.push(id);
    }
  }
  
  if (missing.length === 0) {
    return { ok: true };
  }
  
  return {
    ok: false,
    missing,
  };
}
