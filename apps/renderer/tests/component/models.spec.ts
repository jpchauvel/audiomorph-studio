import { test, expect } from '@playwright/test';
import { installElectronApiMock } from './_setup';

const mockModels = [
  { id: 'model-1', repo_id: 'org/model-1', name: 'Model 1', size_gb: 2.5, state: 'verified' },
  { id: 'model-2', repo_id: 'org/model-2', name: 'Model 2', size_gb: 5.0, state: 'partial' },
];

test.beforeEach(async ({ page }) => {
  await installElectronApiMock(page);
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

// Regression: FastAPI path params reject '/'. Slash-containing model
// ids (e.g. HF org/repo form) MUST be encoded as '__' at the renderer.
const slashModels = [
  {
    id: 'HeartMuLa/HeartMuLaGen',
    repo_id: 'HeartMuLa/HeartMuLaGen',
    name: 'HeartMuLa Gen',
    size_gb: 1.0,
    state: 'partial',
  },
];

test('encodes slash in model id when verifying', async ({ page }) => {
  let encodedVerifyCalled = false;
  let rawSlashVerifyCalled = false;

  await page.route('**/models', async (route) => {
    await route.fulfill({ json: slashModels });
  });
  await page.route('**/models/HeartMuLa__HeartMuLaGen/verify', async (route) => {
    if (route.request().method() === 'POST') {
      encodedVerifyCalled = true;
      await route.fulfill({ json: { valid: true, mismatches: [] } });
    }
  });
  await page.route('**/models/HeartMuLa/HeartMuLaGen/verify', async (route) => {
    rawSlashVerifyCalled = true;
    await route.fulfill({ status: 404, json: { error: 'not found' } });
  });

  await page.goto('/models.html');

  const card = page.locator('.flex-col').filter({ hasText: 'HeartMuLa Gen' });
  await card.getByRole('button', { name: 'Verify' }).click();

  expect(encodedVerifyCalled).toBe(true);
  expect(rawSlashVerifyCalled).toBe(false);
});

test('encodes slash in model id when deleting', async ({ page }) => {
  let encodedDeleteCalled = false;
  let rawSlashDeleteCalled = false;

  await page.route('**/models', async (route) => {
    await route.fulfill({ json: slashModels });
  });
  await page.route('**/models/HeartMuLa__HeartMuLaGen', async (route) => {
    if (route.request().method() === 'DELETE') {
      encodedDeleteCalled = true;
      await route.fulfill({ status: 204 });
    }
  });
  await page.route('**/models/HeartMuLa/HeartMuLaGen', async (route) => {
    if (route.request().method() === 'DELETE') {
      rawSlashDeleteCalled = true;
      await route.fulfill({ status: 404 });
    }
  });

  await page.goto('/models.html');

  const card = page.locator('.flex-col').filter({ hasText: 'HeartMuLa Gen' });
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('text=Delete HeartMuLa Gen?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  expect(encodedDeleteCalled).toBe(true);
  expect(rawSlashDeleteCalled).toBe(false);
});

test('encodes slash in model id when downloading', async ({ page }) => {
  let encodedDownloadCalled = false;
  let rawSlashDownloadCalled = false;

  await page.route('**/models', async (route) => {
    await route.fulfill({ json: slashModels });
  });
  await page.route('**/models/HeartMuLa__HeartMuLaGen/download', async (route) => {
    if (route.request().method() === 'POST') {
      encodedDownloadCalled = true;
      await route.fulfill({ json: { job_id: 'job-xyz', state: 'queued' } });
    }
  });
  await page.route('**/models/HeartMuLa/HeartMuLaGen/download', async (route) => {
    if (route.request().method() === 'POST') {
      rawSlashDownloadCalled = true;
      await route.fulfill({ status: 404 });
    }
  });

  await page.goto('/models.html');

  const card = page.locator('.flex-col').filter({ hasText: 'HeartMuLa Gen' });
  await card.getByRole('button', { name: 'Download' }).click();

  expect(encodedDownloadCalled).toBe(true);
  expect(rawSlashDownloadCalled).toBe(false);
});
