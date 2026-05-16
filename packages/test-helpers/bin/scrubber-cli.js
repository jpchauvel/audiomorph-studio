#!/usr/bin/env node

import { scrubFile } from '../dist/scrubber.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: scrubber-cli <file>');
  process.exit(1);
}

try {
  const result = scrubFile(filePath);
  console.log(`Scrubbed ${filePath}: ${result.replacements} secrets redacted`);
} catch (error) {
  console.error(`Error scrubbing file: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
