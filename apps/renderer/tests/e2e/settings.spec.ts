import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__AUDIOMORPH_VERSION__ = '1.0.0';
      (window as any).__AUDIOMORPH_IPC__ = {
        setOpenRouterKey: async (key: string) => {
          console.log('IPC setOpenRouterKey called', key);
        },
        setHfToken: async (token: string) => {
          console.log('IPC setHfToken called', token);
        },
        openDirectory: async () => {
          return '/mock/models/dir';
        }
      };
    });

    await page.route('**/settings', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models_dir: '/default/models',
          cpu_fallback_enabled: 'false',
          openrouter_key_present: 'false',
          hf_token_present: 'false',
        })
      });
    });

    await page.route('**/settings/*', async route => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 200 });
      } else {
        await route.continue();
      }
    });

    await page.goto('/settings.html');
  });

  test('renders all sections', async ({ page }) => {
    await expect(page.locator('text=Appearance')).toBeVisible();
    await expect(page.locator('text=AI Keys')).toBeVisible();
    await expect(page.locator('text=Models').first()).toBeVisible();
    await expect(page.locator('text=Performance').first()).toBeVisible();
    await expect(page.locator('text=About').first()).toBeVisible();
    await expect(page.getByTestId('app-version')).toHaveText('1.0.0');
  });

  test('key input clears after save and mask shows', async ({ page }) => {
    const input = page.getByTestId('openrouter-key-input');
    const saveBtn = page.getByTestId('save-openrouter-key');

    await expect(input).toHaveAttribute('placeholder', 'sk-or-...');
    
    await input.fill('sk-or-secret-key-123');
    await expect(input).toHaveValue('sk-or-secret-key-123');
    
    await saveBtn.click();

    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('placeholder', '••••••••');
    const content = await page.content();
    expect(content).not.toContain('sk-or-secret-key-123');
  });

  test('CPU fallback toggle updates settings', async ({ page }) => {
    const toggle = page.getByTestId('cpu-fallback-toggle');
    
    await expect(toggle).not.toBeChecked();

    const requestPromise = page.waitForRequest(request => 
      request.url().endsWith('/settings/cpu_fallback_enabled') && 
      request.method() === 'PUT'
    );

    await toggle.click();

    const request = await requestPromise;
    const postData = JSON.parse(request.postData() || '{}');
    expect(postData.value).toBe('true');
  });
});
