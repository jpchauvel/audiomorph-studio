/**
 * Test mode sentinel and utilities for AUDIOMORPH_TEST_MODE environment variable.
 * Used to enable deterministic testing across sidecar, shell, and renderer.
 */

export const TEST_MODE_ENV = 'AUDIOMORPH_TEST_MODE';
export const TEST_TOKEN = 'test-token-deterministic-do-not-use-in-prod';
export const TEST_VAULT_MODE = 'memory';

/**
 * Check if test mode is enabled via AUDIOMORPH_TEST_MODE=1
 */
export function isTestMode(): boolean {
  return process.env[TEST_MODE_ENV] === '1';
}

/**
 * Assert that test mode is enabled; throw if not.
 */
export function assertTestMode(): void {
  if (!isTestMode()) {
    throw new Error(`Test mode not enabled. Set ${TEST_MODE_ENV}=1 to enable.`);
  }
}

/**
 * Get test environment variables as an object.
 */
export function getTestEnv(): Record<string, string> {
  return {
    [TEST_MODE_ENV]: '1',
  };
}
