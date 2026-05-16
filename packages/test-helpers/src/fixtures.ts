import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '..', 'fixtures');

/**
 * Get the absolute path to a test fixture file.
 * @param category - The fixture category (e.g., 'audio', 'lyrics', 'openrouter')
 * @param name - The fixture name (e.g., 'short.wav', 'sample.txt')
 * @returns The absolute path to the fixture file
 */
export function getFixturePath(category: string, name: string): string {
  return join(fixturesDir, category, name);
}
