import { test, expect as _expect } from '@playwright/test';
import path from 'path';

test('take screenshot', async ({ page }) => {
  const url = `file://${path.resolve(__dirname, '../../out/index.html')}`;
  await page.goto(url);
  await page.waitForTimeout(500); // give it time to render
  await page.screenshot({ path: '../../.sisyphus/evidence/task-W3.1-boot.png' });
});
