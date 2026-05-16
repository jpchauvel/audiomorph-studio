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

test('first-run wizard renders against real sidecar', async ({ page, sidecar, staticServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await installRendererBootstrap(page, sidecar.baseUrl, sidecar.token);

  const response = await page.goto(`${staticServer.url}/first-run/index.html`);
  expect(response?.ok()).toBeTruthy();

  await page.waitForFunction(() => document.readyState === 'complete');
  await expect(page.locator('body')).toBeVisible();

  const html = await page.content();
  expect(html, 'token must not appear raw in DOM').not.toContain(TEST_TOKEN);
  expect(errors, `pageerror(s): ${errors.join(' | ')}`).toEqual([]);
});
