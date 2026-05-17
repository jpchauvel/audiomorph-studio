import { test, expect } from '@playwright/test';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';

const outDir = path.resolve(__dirname, '../../out');
let serverProcess: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 301 || res.status === 302) return;
    } catch {
      void 0;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

test.beforeAll(async () => {
  serverProcess = spawn('pnpm', ['dlx', 'serve@latest', outDir, '-l', '8080'], {
    stdio: 'pipe',
  });
  await waitForServer('http://localhost:8080/first-run/index.html');
});

test.afterAll(() => {
  if (serverProcess) serverProcess.kill();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__AUDIOMORPH_API_BASE__ = 'http://localhost:8000';
    (window as any).__AUDIOMORPH_TOKEN__ = 'test-token';
    (window as any).__AUDIOMORPH_IPC__ = {
      openDirectory: async () => '/tmp/models',
      getDiskFreeGb: async () => 50,
    };
  });
  await page.route('**/first-run/status', (route) =>
    route.fulfill({
      json: { completed: false, missing_steps: ['pick_models_dir', 'download_models'] },
    }),
  );
});

test('wizard renders step 1 on load', async ({ page }) => {
  await page.goto(`http://localhost:8080/first-run/index.html`);
  await expect(page.getByTestId('first-run-wizard')).toBeVisible();
  await expect(page.getByTestId('step1-next')).toBeVisible();
  await page.screenshot({ path: '.sisyphus/evidence/task-W3.2-step1.png' });
});

test('step progression: 1 → 2 → 3', async ({ page }) => {
  await page.goto(`http://localhost:8080/first-run/index.html`);
  await page.getByTestId('step1-next').click();
  await expect(page.getByTestId('pick-dir-btn')).toBeVisible();
  await page.screenshot({ path: '.sisyphus/evidence/task-W3.2-step2.png' });
  await page.getByTestId('pick-dir-btn').click();
  await expect(page.getByTestId('step2-next')).toBeEnabled();
  await page.route('**/models', (route) =>
    route.fulfill({
      json: [
        { id: 'm1', repo_id: 'HeartMuLa/Gen', name: 'HeartMuLaGen', size_gb: 5, state: 'missing' },
      ],
    }),
  );
  await page.getByTestId('step2-next').click();
  await expect(page.getByTestId('model-row-m1')).toBeVisible();
  await page.screenshot({ path: '.sisyphus/evidence/task-W3.2-step3.png' });
});

test('low disk blocks next button', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__AUDIOMORPH_IPC__ = {
      openDirectory: async () => '/tmp/small',
      getDiskFreeGb: async () => 5,
    };
  });
  await page.goto(`http://localhost:8080/first-run/index.html`);
  await page.getByTestId('step1-next').click();
  await page.getByTestId('pick-dir-btn').click();
  await expect(page.getByTestId('low-disk-error')).toBeVisible();
  await expect(page.getByTestId('step2-next')).toBeDisabled();
  await page.screenshot({ path: '.sisyphus/evidence/task-W3.2-low-disk.png' });
});

test('redirect to / if already completed', async ({ page }) => {
  await page.unroute('**/first-run/status');
  await page.route('**/first-run/status', (route) =>
    route.fulfill({ json: { completed: true, missing_steps: [] } }),
  );
  await page.goto(`http://localhost:8080/first-run/index.html`);
  await expect(page).toHaveURL(/\/$|\/index\.html$/, { timeout: 10000 });
});
