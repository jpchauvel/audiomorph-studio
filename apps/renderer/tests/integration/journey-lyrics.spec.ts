import { expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  createSidecarFixture,
  installRendererBootstrap,
  RENDERER_BUILD_PRESENT,
  SIDECAR_RUNTIME_PRESENT,
  startOpenRouterStub,
  TEST_TOKEN,
} from './_setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixturePath = path.resolve(
  __dirname,
  '../../../../packages/test-helpers/fixtures/openrouter/chat-response.json',
);
const fixtureBody = fs.existsSync(fixturePath) ? fs.readFileSync(fixturePath, 'utf-8') : '{}';

let stubUrl = '';
const stubReady = (async () => {
  const h = await startOpenRouterStub(fixtureBody);
  stubUrl = h.url;
  return h;
})();

const test = createSidecarFixture();

test.skip(!RENDERER_BUILD_PRESENT, 'renderer not built (apps/renderer/out missing)');
test.skip(!SIDECAR_RUNTIME_PRESENT, 'sidecar runtime missing (.venv/bin/python not found)');

test('lyrics page loads with stubbed OpenRouter backend', async ({ page, sidecar, staticServer }) => {
  await stubReady;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await installRendererBootstrap(page, sidecar.baseUrl, sidecar.token);

  const response = await page.goto(`${staticServer.url}/lyrics/index.html`);
  expect(response?.ok()).toBeTruthy();
  await page.waitForFunction(() => document.readyState === 'complete');

  expect(stubUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  const html = await page.content();
  expect(html).not.toContain(TEST_TOKEN);
  expect(errors).toEqual([]);
});

test.afterAll(async () => {
  const h = await stubReady;
  await h.kill();
});
