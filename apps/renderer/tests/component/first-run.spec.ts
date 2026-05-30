import { test, expect } from '@playwright/test';
import { installElectronApiMock } from './_setup';

test.beforeEach(async ({ page }) => {
  await installElectronApiMock(page);
  await page.addInitScript(() => {
    window.__AUDIOMORPH_IPC__ = {
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
  await page.goto(`/first-run.html`);
  await expect(page.getByTestId('first-run-wizard')).toBeVisible();
  await expect(page.getByTestId('step1-next')).toBeVisible();
});

test('step progression: 1 → 2 → 3', async ({ page }) => {
  await page.goto(`/first-run.html`);
  await page.getByTestId('step1-next').click();
  await expect(page.getByTestId('pick-dir-btn')).toBeVisible();
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
});

test('low disk blocks next button', async ({ page }) => {
  await page.addInitScript(() => {
    window.__AUDIOMORPH_IPC__ = {
      openDirectory: async () => '/tmp/small',
      getDiskFreeGb: async () => 5,
    };
  });
  await page.goto(`/first-run.html`);
  await page.getByTestId('step1-next').click();
  await page.getByTestId('pick-dir-btn').click();
  await expect(page.getByTestId('low-disk-error')).toBeVisible();
  await expect(page.getByTestId('step2-next')).toBeDisabled();
});

test('redirect to / if already completed', async ({ page }) => {
  await page.unroute('**/first-run/status');
  await page.route('**/first-run/status', (route) =>
    route.fulfill({ json: { completed: true, missing_steps: [] } }),
  );
  await page.goto(`/first-run.html`);
  await expect(page).toHaveURL(/\/$|\/index(\.html)?$/, { timeout: 10000 });
});
