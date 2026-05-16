import { test, expect } from '@playwright/test';

const ROUTES = [
  { slug: 'root', path: '/' },
  { slug: 'diagnostics', path: '/diagnostics' },
  { slug: 'first-run', path: '/first-run' },
  { slug: 'lyrics', path: '/lyrics' },
  { slug: 'models', path: '/models' },
  { slug: 'settings', path: '/settings' },
] as const;

const THEMES = ['light', 'dark'] as const;

test.describe('visual regression — all routes × {light,dark}', () => {
  for (const route of ROUTES) {
    for (const theme of THEMES) {
      test(`${route.slug} @ ${theme}`, async ({ page }) => {
        await page.goto(route.path, { waitUntil: 'networkidle' });
        await page.evaluate((t) => {
          document.documentElement.setAttribute('data-theme', t);
        }, theme);
        await page
          .locator('[data-testid="route-ready"]')
          .first()
          .waitFor({ state: 'attached', timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`${route.slug}-${theme}.png`, {
          fullPage: true,
          mask: [page.locator('[data-volatile]')],
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
});
