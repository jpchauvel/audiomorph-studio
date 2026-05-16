import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

export interface ScrubResult {
  replacements: number;
}

export interface DirectoryScrubResult {
  filesProcessed: number;
  replacements: number;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'AUDIOMORPH_TOKEN',
    pattern: /X-Audiomorph-Token:\s+\S+/g,
  },
  {
    name: 'BEARER_TOKEN',
    pattern: /Authorization:\s+Bearer\s+\S+/g,
  },
  {
    name: 'OPENROUTER_KEY',
    pattern: /sk-or-[a-zA-Z0-9\-]+/g,
  },
  {
    name: 'HUGGINGFACE_TOKEN',
    pattern: /hf_[a-zA-Z0-9]+/g,
  },
  {
    name: 'GENERIC_BEARER',
    pattern: /Bearer\s+[A-Za-z0-9._\-]{20,}/g,
  },
];

export function scrubSecrets(text: string): ScrubResult {
  let replacements = 0;
  let scrubbed = text;

  for (const { name, pattern } of SECRET_PATTERNS) {
    const matches = scrubbed.match(pattern);
    if (matches) {
      replacements += matches.length;
      scrubbed = scrubbed.replace(pattern, `[REDACTED-${name}]`);
    }
  }

  return { replacements };
}

export function scrubFile(filePath: string): ScrubResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  let replacements = 0;
  let scrubbedContent = content;

  for (const { name, pattern } of SECRET_PATTERNS) {
    const matches = scrubbedContent.match(pattern);
    if (matches) {
      replacements += matches.length;
      scrubbedContent = scrubbedContent.replace(pattern, `[REDACTED-${name}]`);
    }
  }

  if (replacements > 0) {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, scrubbedContent);
    fs.renameSync(tempPath, filePath);
  }

  return { replacements };
}

export async function scrubDirectory(
  dir: string,
  extensions: string[] = ['.ts', '.js', '.py', '.json', '.txt', '.md', '.log']
): Promise<DirectoryScrubResult> {
  let filesProcessed = 0;
  let replacements = 0;

  const processDir = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        processDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          try {
            const result = scrubFile(fullPath);
            filesProcessed++;
            replacements += result.replacements;
          } catch {
            continue;
          }
        }
      }
    }
  };

  processDir(dir);
  return { filesProcessed, replacements };
}
