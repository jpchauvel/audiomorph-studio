import { test, expect } from '@playwright/test';

test('CI guard — component config invariants', async ({ page }) => {
  const mode = process.env.AUDIOMORPH_TEST_MODE;
  const validMode = mode === undefined || mode === '1';
  expect(
    validMode,
    `AUDIOMORPH_TEST_MODE must be undefined or "1", got: ${JSON.stringify(mode)}`,
  ).toBe(true);

  await page.goto('/');

  const ipcProbe = await page.evaluate(() => {
    const ipc = (window as unknown as { __AUDIOMORPH_IPC__?: unknown }).__AUDIOMORPH_IPC__;
    return { defined: ipc !== undefined, type: typeof ipc };
  });
  expect(['undefined', 'object', 'function']).toContain(ipcProbe.type);

  const integrationLeak = await page.evaluate(() => {
    return (window as unknown as { __AUDIOMORPH_INTEGRATION_SETUP__?: unknown })
      .__AUDIOMORPH_INTEGRATION_SETUP__;
  });
  expect(integrationLeak).toBeUndefined();
});
