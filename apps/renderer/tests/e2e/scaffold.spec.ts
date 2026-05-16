import { test, expect } from '@playwright/test';
import path from 'path';

test('app boots with dark theme', async ({ page }) => {
  const url = `file://${path.resolve(__dirname, '../../out/index.html')}`;
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('OKLCH primary token resolves', async ({ page }) => {
  const url = `file://${path.resolve(__dirname, '../../out/index.html')}`;
  await page.goto(url);
  const val = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--color-primary');
  });
  // Browsers might convert OKLCH to LAB in getComputedStyle
  expect(val).toMatch(/(oklch|lab|color)/);
});
