import { test, expect } from '@playwright/test';

test.describe('Export Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      window.localStorage.setItem('generation-store', JSON.stringify({
        state: { phase: 'done', resultJobId: 'test-job-id' },
        version: 0
      }));
    });
    
    await page.reload();

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
    await expect(formatSelect).toHaveText(/WAV/);
    
    await expect(page.getByTestId('bitrate-select')).toBeHidden();

    await formatSelect.click();
    await page.getByRole('option', { name: 'MP3 (lossy)' }).click();

    const bitrateSelect = page.getByTestId('bitrate-select');
    await expect(bitrateSelect).toBeVisible();
    await expect(bitrateSelect).toHaveText(/192 kbps/);

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
