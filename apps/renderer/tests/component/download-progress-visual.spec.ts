import { test, expect } from '@playwright/test';
import { installElectronApiMock } from './_setup';

const ARTIFACT = 'playwright-report/visual/downloading-card.png';

const downloadingModel = [
  {
    id: 'visual/model',
    repo_id: 'visual/model',
    name: 'Visual Model',
    size_gb: 1.5,
    state: 'missing',
  },
];

test.beforeEach(async ({ page }) => {
  await installElectronApiMock(page);
  await page.route('**/settings', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          hf_token_present: true,
          openrouter_key_present: false,
          first_run_completed: true,
          cpu_fallback_enabled: false,
          models_dir: '',
          default_model_id: '',
          theme: 'system',
        },
      });
    }
  });
});

test('non-downloaded model shows visible progress UI during download', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: downloadingModel });
  });
  await page.route('**/models/visual__model/download', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { job_id: 'job-visual', state: 'queued' } });
    }
  });
  await page.route('**/models/jobs/job-visual/events', async (route) => {
    const body =
      'event: progress\ndata: {"bytes_done":768000000,"bytes_total":1610612736,"speed_mbps":42.7,"current_file":"pytorch_model-00001-of-00002.bin","state":"downloading"}\n\n';
    await route.fulfill({ contentType: 'text/event-stream', body });
  });

  await page.goto('/models.html');

  const card = page.locator('.flex-col').filter({ hasText: 'Visual Model' });
  await card.getByRole('button', { name: 'Download' }).click();

  const progressPanel = card.locator('text=Downloading...').first();
  await expect(progressPanel).toBeVisible();
  await expect(card.locator('text=pytorch_model-00001-of-00002.bin')).toBeVisible();
  await expect(card.locator('text=Mbps')).toBeVisible();

  const bar = card.locator('[role="progressbar"]');
  await expect(bar).toBeVisible();
  const valueNow = await bar.getAttribute('aria-valuenow');
  expect(Number(valueNow ?? '0')).toBeGreaterThan(0);

  await page.screenshot({
    path: ARTIFACT,
    fullPage: false,
  });
});
