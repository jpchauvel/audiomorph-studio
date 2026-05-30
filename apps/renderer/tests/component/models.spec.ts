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

test('shows HuggingFace Login button in header', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });

  await page.goto('/models.html');

  await expect(page.getByTestId('hf-login-button')).toBeVisible();
});

test('saves HF token via vault when login dialog submitted', async ({ page }) => {
  let putCalled = false;
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });
  await page.route('**/settings/hf_token_present', async (route) => {
    if (route.request().method() === 'PUT') {
      putCalled = true;
      await route.fulfill({ status: 204 });
    }
  });

  await page.goto('/models.html');

  await page.getByTestId('hf-login-button').click();
  await expect(page.getByTestId('hf-login-dialog')).toBeVisible();
  await page.getByTestId('hf-login-input').fill('hf_test_xyz');
  await page.getByTestId('hf-login-save').click();

  await expect(page.locator('text=HuggingFace token saved')).toBeVisible();
  expect(putCalled).toBe(true);
});

test('auto-opens HF login dialog when download fails with AUTH_REQUIRED', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });
  await page.route('**/models/model-2/download', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { job_id: 'job-auth', state: 'queued' } });
    }
  });
  await page.route('**/models/jobs/job-auth/events', async (route) => {
    const body =
      'event: progress\ndata: {"bytes_done":0,"bytes_total":0,"speed_mbps":0,"current_file":null,"state":"failed","error":"unauthorized","error_code":"AUTH_REQUIRED"}\n\n';
    await route.fulfill({ contentType: 'text/event-stream', body });
  });

  await page.goto('/models.html');

  const card = page.locator('.flex-col').filter({ hasText: 'Model 2' });
  await card.getByRole('button', { name: 'Download' }).click();

  await expect(page.getByTestId('hf-login-dialog')).toBeVisible();
});

test('progress bar reflects bytes_done from SSE events', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });
  await page.route('**/models/model-2/download', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { job_id: 'job-pg', state: 'queued' } });
    }
  });
  await page.route('**/models/jobs/job-pg/events', async (route) => {
    const body =
      'event: progress\ndata: {"bytes_done":512,"bytes_total":1024,"speed_mbps":2.5,"current_file":"part-1.bin","state":"downloading"}\n\n';
    await route.fulfill({ contentType: 'text/event-stream', body });
  });

  await page.goto('/models.html');

  const card = page.locator('.flex-col').filter({ hasText: 'Model 2' });
  await card.getByRole('button', { name: 'Download' }).click();

  await expect(card.locator('text=part-1.bin')).toBeVisible();
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
