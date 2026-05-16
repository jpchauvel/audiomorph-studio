import { test, expect } from '@playwright/test';

test.describe('Prompt Assist Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('http://localhost:8000/settings', async (route) => {
      await route.fulfill({ json: { openrouter_key_present: 'false' } });
    });

    await page.route('http://localhost:8000/models', async (route) => {
      await route.fulfill({ json: [{ id: 'model-1', name: 'Model 1', state: 'verified' }] });
    });

    await page.addInitScript(() => {
      (window as any).__AUDIOMORPH_OPENROUTER_KEY__ = 'test-key';
      (window as any).__AUDIOMORPH_API_BASE__ = 'http://localhost:8000';
      (window as any).__AUDIOMORPH_TOKEN__ = 'test-token';
    });
  });

  test('drawer opens and shows missing key alert', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Improve with AI ✨' }).click();

    await expect(page.getByRole('dialog', { name: 'Prompt Assist ✨' })).toBeVisible();

    await expect(page.getByText('Missing OpenRouter Key')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  test('generates response and injects prompt', async ({ page }) => {
    await page.route('http://localhost:8000/settings', async (route) => {
      await route.fulfill({ json: { openrouter_key_present: 'true' } });
    });

    await page.route('http://localhost:8000/openrouter/chat', async (route) => {
      await route.fulfill({
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'data: {"choices":[{"delta":{"content":"{\\"prompt\\": \\"A cool generated prompt\\""}}]}\n\ndata: {"choices":[{"delta":{"content":", \\"lyrics\\": \\"cool lyrics\\"}"}}]}\n\ndata: [DONE]\n\n',
      });
    });

    await page.goto('/');

    await page.getByRole('button', { name: 'Improve with AI ✨' }).click();

    const textarea = page.getByPlaceholder('e.g., An upbeat synthwave track');
    await textarea.fill('make it cool');

    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    await expect(page.getByText('A cool generated prompt')).toBeVisible();

    await page.getByRole('button', { name: 'Use this prompt' }).click();

    await expect(page.getByRole('dialog', { name: 'Prompt Assist ✨' })).toBeHidden();

    await expect(page.getByLabel('Prompt *')).toHaveValue('A cool generated prompt');
  });
});
