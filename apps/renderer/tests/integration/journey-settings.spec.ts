import { expect } from '@playwright/test';
import {
  createSidecarFixture,
  installRendererBootstrap,
  RENDERER_BUILD_PRESENT,
  SIDECAR_RUNTIME_PRESENT,
  TEST_TOKEN,
} from './_setup.js';

const test = createSidecarFixture();

test.skip(!RENDERER_BUILD_PRESENT, 'renderer not built (apps/renderer/out missing)');
test.skip(!SIDECAR_RUNTIME_PRESENT, 'sidecar runtime missing (.venv/bin/python not found)');

test('settings page loads and sidecar is reachable', async ({ page, sidecar, staticServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await installRendererBootstrap(page, sidecar.baseUrl, sidecar.token);

  const response = await page.goto(`${staticServer.url}/settings/index.html`);
  expect(response?.ok()).toBeTruthy();
  await page.waitForFunction(() => document.readyState === 'complete');

  const authProbe = await page.evaluate(
    async ({ base, token }) => {
      const r = await fetch(`${base}/healthz`, { headers: { 'X-Audiomorph-Token': token } });
      return r.status;
    },
    { base: sidecar.baseUrl, token: sidecar.token },
  );
  expect(authProbe).toBeLessThan(500);

  const html = await page.content();
  expect(html).not.toContain(TEST_TOKEN);
  expect(errors).toEqual([]);
});
