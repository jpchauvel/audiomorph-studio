import { test, expect } from '@playwright/test';
import { installElectronApiMock } from './_setup';

test.describe('Prompt Assist Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await installElectronApiMock(page);
    await page.route('**/settings', async (route) => {
      await route.fulfill({ json: { openrouter_key_present: 'false' } });
    });

    await page.route('**/models', async (route) => {
      await route.fulfill({
        json: [{ id: 'model-1', name: 'Model 1', state: 'verified', role: 'generation' }],
      });
    });

    await page.addInitScript(() => {
      window.__AUDIOMORPH_OPENROUTER_KEY__ = 'test-key';
    });
  });

  test('drawer opens and shows missing key alert', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Improve with AI ✨' }).click();

    await expect(page.getByRole('dialog', { name: 'Prompt Assist ✨' })).toBeVisible();

    await expect(page.getByText('Missing OpenRouter Key')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });
});
