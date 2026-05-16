import { test, expect } from '@playwright/test';

const mockModels = [
  { id: 'model-1', repo_id: 'org/model-1', name: 'Model 1', size_gb: 2.5, state: 'verified' },
  { id: 'model-2', repo_id: 'org/model-2', name: 'Model 2', size_gb: 5.0, state: 'partial' },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__AUDIOMORPH_API_BASE__ = 'http://localhost:8000';
    (window as any).__AUDIOMORPH_TOKEN__ = 'test-token';
  });
});

test('displays list of models', async ({ page }) => {
  await page.route('**/models', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: mockModels });
    }
  });

  await page.goto('/models.html');

  await expect(page.locator('text=Model Library')).toBeVisible();
  await expect(page.locator('text=Model 1')).toBeVisible();
  await expect(page.locator('text=org/model-1')).toBeVisible();
  await expect(page.locator('text=verified')).toBeVisible();

  await expect(page.locator('text=Model 2')).toBeVisible();
  await expect(page.locator('text=partial')).toBeVisible();
});

test('requires confirmation to delete a model', async ({ page }) => {
  let deleteCalled = false;
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });

  await page.route('**/models/model-1', async (route) => {
    if (route.request().method() === 'DELETE') {
      deleteCalled = true;
      await route.fulfill({ status: 204 });
    }
  });

  await page.goto('/models.html');

  const model1Card = page.locator('.flex-col').filter({ hasText: 'Model 1' });
  await model1Card.getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('text=Delete Model 1?')).toBeVisible();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  expect(deleteCalled).toBe(true);
  await expect(page.locator('text=Deleted Model 1')).toBeVisible();
});

test('handles verify action', async ({ page }) => {
  let verifyCalled = false;
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });

  await page.route('**/models/model-2/verify', async (route) => {
    if (route.request().method() === 'POST') {
      verifyCalled = true;
      await route.fulfill({ json: { valid: true, mismatches: [] } });
    }
  });

  await page.goto('/models.html');

  const model2Card = page.locator('.flex-col').filter({ hasText: 'Model 2' });
  await model2Card.getByRole('button', { name: 'Verify' }).click();

  expect(verifyCalled).toBe(true);
  await expect(page.locator('text=Model 2 is fully verified')).toBeVisible();
});
