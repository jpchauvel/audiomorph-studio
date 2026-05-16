import { test, expect } from '@playwright/test';

test.describe('Export Dialog', () => {
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
        body: JSON.stringify({ job_id: 'test-job-id' }),
      });
    });

    await page.route('**/jobs/test-job-id/events', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: done\ndata: {}\n\n',
      });
    });

    await page.goto('/');

    await page.getByPlaceholder('Describe the music you want to generate...').fill('export test prompt');
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Generation complete')).toBeVisible();

    await page.evaluate(() => {
      (window as any).__AUDIOMORPH_IPC__ = {
        showItemInFolder: () => {}
      };
    });
  });

  test('opens export dialog, shows bitrate only for mp3, exports successfully', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: 'Export' });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Export Audio')).toBeVisible();

    const formatSelect = page.getByTestId('format-select');
    await expect(formatSelect).toHaveText(/wav/i);
    
    await expect(page.getByTestId('bitrate-select')).toBeHidden();

    await formatSelect.click();
    await page.getByRole('option', { name: 'MP3 (lossy)' }).click();

    const bitrateSelect = page.getByTestId('bitrate-select');
    await expect(bitrateSelect).toBeVisible();
    await expect(bitrateSelect).toHaveText(/192/i);

    await page.route('**/export', async (route) => {
      const request = route.request();
      expect(request.method()).toBe('POST');
      const body = JSON.parse(request.postData() || '{}');
      expect(body).toEqual({
        job_id: 'test-job-id',
        format: 'mp3',
        bitrate_kbps: 192
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ file_path: '/mock/path/audio.mp3', size_bytes: 1024 })
      });
    });

    await page.evaluate(() => {
      (window as any).folderOpenedPath = null;
      (window as any).__AUDIOMORPH_IPC__ = {
        showItemInFolder: (path: string) => { (window as any).folderOpenedPath = path; }
      };
    });

    const dialogExportBtn = page.getByTestId('export-btn');
    await dialogExportBtn.click();

    await expect(page.getByText('Exported to /mock/path/audio.mp3')).toBeVisible();

    const showInFinderBtn = page.getByRole('button', { name: 'Show in Finder' });
    await expect(showInFinderBtn).toBeVisible();
    await showInFinderBtn.click();

    const openedPath = await page.evaluate(() => (window as any).folderOpenedPath);
    expect(openedPath).toBe('/mock/path/audio.mp3');

    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
