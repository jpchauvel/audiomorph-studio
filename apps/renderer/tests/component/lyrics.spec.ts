import { test, expect } from '@playwright/test';

test.describe('Lyrics Workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/lyrics/transcribe', async (route) => {
      const form = route.request().postData();
      if (form) {
        await route.fulfill({ json: { job_id: 'mock-job-123' } });
      } else {
        await route.continue();
      }
    });

    await page.route('**/lyrics/jobs/*/events', async (_route) => {});

    await page.goto('http://localhost:3000/lyrics');
  });

  test('renders drop zone', async ({ page }) => {
    await expect(page.getByTestId('lyrics-workspace')).toBeVisible();
    await expect(page.getByTestId('drop-zone')).toBeVisible();
    await expect(page.getByTestId('drop-zone')).toContainText('Drop audio file here');
  });

  test('"Use in Generation" disabled when lyrics empty', async ({ page }) => {
    const btn = page.getByTestId('use-in-generation-btn');
    await expect(btn).toBeDisabled();
  });

  test('typing in editor enables "Use in Generation" and navigates on click', async ({ page }) => {
    const editor = page.getByTestId('lyrics-editor');
    const btn = page.getByTestId('use-in-generation-btn');

    await expect(btn).toBeDisabled();

    await editor.fill('Some mock lyrics here');
    await expect(btn).toBeEnabled();

    await btn.click();

    await expect(page).toHaveURL('http://localhost:3000/');
  });

  test('cancel button visible during transcription', async ({ page }) => {
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByTestId('drop-zone').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'test.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from([1, 2, 3]),
    });

    const cancelBtn = page.getByTestId('cancel-transcription-btn');
    await expect(cancelBtn).toBeVisible();
    await expect(page.getByTestId('drop-zone')).toContainText('Transcribing');

    await page.route('**/lyrics/jobs/mock-job-123', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 204 });
      }
    });

    await cancelBtn.click();
    await expect(cancelBtn).not.toBeVisible();
    await expect(page.getByTestId('drop-zone')).toContainText('Drop audio file here');
  });
});
