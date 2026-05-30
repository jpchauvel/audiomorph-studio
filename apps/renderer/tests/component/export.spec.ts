import { test, expect } from '@playwright/test';
import { installElectronApiMock } from './_setup';

test.describe('Export Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await installElectronApiMock(page);
    await page.route('**/models', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'model-1', name: 'Test Model', state: 'verified', role: 'generation' },
        ]),
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

    await page
      .getByPlaceholder('Describe the music you want to generate...')
      .fill('export test prompt');
    await page.getByRole('button', { name: /generate/i }).click();
    await expect(page.getByText('Generation complete')).toBeVisible();
  });

  test('opens export dialog, shows bitrate only for mp3, prompts saveAs and copies to chosen path', async ({
    page,
  }) => {
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
        bitrate_kbps: 192,
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          file_path: '/app-data/jobs/test-job-id/export.mp3',
          format: 'mp3',
          size_bytes: 1024,
        }),
      });
    });

    await page.evaluate(() => {
      window.__SAVE_AS_DEFAULT__ = null;
      window.__SAVE_AS_FILTERS__ = null;
      window.__COPY_ARGS__ = null;
      window.__SHOW_IN_FOLDER_PATH__ = null;
      const api = (
        window as unknown as {
          electronAPI: {
            saveAs: (a: {
              defaultPath?: string;
              filters?: unknown;
            }) => Promise<{ filePath?: string; canceled: boolean }>;
            copyFile: (a: { src: string; dst: string }) => Promise<{ ok: true }>;
            showItemInFolder: (a: { filePath: string }) => Promise<{ ok: true }>;
          };
        }
      ).electronAPI;
      api.saveAs = async ({ defaultPath, filters }) => {
        window.__SAVE_AS_DEFAULT__ = defaultPath ?? null;
        window.__SAVE_AS_FILTERS__ = (filters ?? null) as unknown as null;
        return { filePath: '/Users/me/Music/my-song.mp3', canceled: false };
      };
      api.copyFile = async ({ src, dst }) => {
        window.__COPY_ARGS__ = { src, dst };
        return { ok: true };
      };
      api.showItemInFolder = async ({ filePath }) => {
        window.__SHOW_IN_FOLDER_PATH__ = filePath;
        return { ok: true };
      };
    });

    await page.getByTestId('export-btn').click();

    await expect(page.getByText('Exported to /Users/me/Music/my-song.mp3')).toBeVisible();

    const saveAsDefault = await page.evaluate(() => window.__SAVE_AS_DEFAULT__);
    expect(saveAsDefault).toMatch(/\.mp3$/);

    const copyArgs = await page.evaluate(() => window.__COPY_ARGS__);
    expect(copyArgs).toEqual({
      src: '/app-data/jobs/test-job-id/export.mp3',
      dst: '/Users/me/Music/my-song.mp3',
    });

    await page.getByRole('button', { name: 'Show in Finder' }).click();
    const opened = await page.evaluate(() => window.__SHOW_IN_FOLDER_PATH__);
    expect(opened).toBe('/Users/me/Music/my-song.mp3');

    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('saveAs cancellation does not copy and shows no success toast', async ({ page }) => {
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.route('**/export', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          file_path: '/app-data/jobs/test-job-id/export.wav',
          format: 'wav',
          size_bytes: 1024,
        }),
      });
    });

    await page.evaluate(() => {
      window.__COPY_CALLED__ = false;
      const api = (
        window as unknown as {
          electronAPI: {
            saveAs: () => Promise<{ filePath?: string; canceled: boolean }>;
            copyFile: () => Promise<{ ok: true }>;
          };
        }
      ).electronAPI;
      api.saveAs = async () => ({ canceled: true, filePath: undefined });
      api.copyFile = async () => {
        window.__COPY_CALLED__ = true;
        return { ok: true };
      };
    });

    await page.getByTestId('export-btn').click();

    await expect(page.getByText(/export cancell?ed/i)).toBeVisible();
    const copyCalled = await page.evaluate(() => window.__COPY_CALLED__);
    expect(copyCalled).toBe(false);
    await expect(page.getByText(/exported to/i)).toBeHidden();
  });
});
