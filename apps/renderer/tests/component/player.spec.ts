import { test, expect } from '@playwright/test';

test.describe('Player Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/models', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'model-1', name: 'Test Model', state: 'verified' }]),
      });
    });

    await page.route('**/jobs/generate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 'test-job' }),
      });
    });

    await page.route('**/jobs/test-job/events', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: done\ndata: {}\n\n',
      });
    });

    await page.goto('/');
  });

  test('renders player after generation completes', async ({ page }) => {
    const input = page.getByPlaceholder('Describe the music you want to generate...');
    await input.fill('test sound');
    await page.getByRole('button', { name: /generate/i }).click();

    await expect(page.getByText('Generation complete')).toBeVisible({ timeout: 15000 });

    const player = page.getByTestId('waveform-player');
    await expect(player).toBeVisible();

    const playPauseBtn = page.getByTestId('play-pause-btn');
    await expect(playPauseBtn).toBeVisible();
    await expect(playPauseBtn).toHaveText('▶');
  });
});
