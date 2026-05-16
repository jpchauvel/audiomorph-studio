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

test('generate page loads and sidecar healthz responds', async ({
  page,
  sidecar,
  staticServer,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await installRendererBootstrap(page, sidecar.baseUrl, sidecar.token);

  const response = await page.goto(`${staticServer.url}/index.html`);
  expect(response?.ok()).toBeTruthy();
  await page.waitForFunction(() => document.readyState === 'complete');

  const health = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/healthz`);
    return { ok: r.ok, status: r.status };
  }, sidecar.baseUrl);
  expect(health.ok).toBe(true);

  const html = await page.content();
  expect(html).not.toContain(TEST_TOKEN);
  expect(errors).toEqual([]);
});
