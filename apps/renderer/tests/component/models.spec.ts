import { test, expect } from '@playwright/test';
import { installElectronApiMock } from './_setup';

const mockModels = [
  { id: 'model-1', repo_id: 'org/model-1', name: 'Model 1', size_gb: 2.5, state: 'verified' },
  { id: 'model-2', repo_id: 'org/model-2', name: 'Model 2', size_gb: 5.0, state: 'partial' },
];

test.beforeEach(async ({ page }) => {
  await installElectronApiMock(page);
  await page.route('**/settings', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          hf_token_present: true,
          openrouter_key_present: false,
          first_run_completed: true,
          cpu_fallback_enabled: false,
          models_dir: '',
          default_model_id: '',
          theme: 'system',
        },
      });
    }
  });
  await page.route('**/settings/hf_token_present', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 204 });
    }
  });
  await page.route('**/verify', async (route) => {
    await route.fulfill({ json: { valid: true, mismatches: [] } });
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

test('shows Download button disabled for verified models', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });
  await page.route('**/models/model-1/verify', async (route) => {
    await route.fulfill({ json: { valid: true, mismatches: [] } });
  });

  await page.goto('/models.html');

  const card = page.locator('.flex-col').filter({ hasText: 'Model 1' });
  const dlBtn = card.getByRole('button', { name: 'Download' });
  await expect(dlBtn).toBeVisible();
  await expect(dlBtn).toBeDisabled();
});

test('auto re-verifies verified models on mount', async ({ page }) => {
  let verifyCallCount = 0;
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });
  await page.route('**/models/model-1/verify', async (route) => {
    if (route.request().method() === 'POST') {
      verifyCallCount += 1;
      await route.fulfill({ json: { valid: true, mismatches: [] } });
    }
  });

  await page.goto('/models.html');
  await page.waitForFunction(() => !!document.querySelector('[data-testid="route-ready"]'));
  await page.waitForTimeout(200);

  expect(verifyCallCount).toBeGreaterThanOrEqual(1);
});

test('auto-navigates to Studio when all required models are verified', async ({ page }) => {
  const allVerified = [
    { id: 'm-1', repo_id: 'org/m-1', name: 'M1', size_gb: 1, state: 'verified' },
    { id: 'm-2', repo_id: 'org/m-2', name: 'M2', size_gb: 1, state: 'verified' },
  ];
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: allVerified });
  });
  await page.route('**/verify', async (route) => {
    await route.fulfill({ json: { valid: true, mismatches: [] } });
  });

  await page.goto('/models.html');
  await page.waitForURL((url) => !url.pathname.endsWith('/models.html'), { timeout: 5000 });
  expect(page.url()).not.toContain('models.html');
});

test('does NOT auto-navigate when at least one model is not verified', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });

  await page.goto('/models.html');
  await page.waitForFunction(() => !!document.querySelector('[data-testid="route-ready"]'));
  await page.waitForTimeout(500);
  expect(page.url()).toMatch(/\/models(\.html)?$/);
});

test('auto re-verifies partial models on mount (sidecar restart scenario)', async ({ page }) => {
  const partialModels = [
    {
      id: 'partial-1',
      repo_id: 'org/partial-1',
      name: 'Partial 1',
      size_gb: 1.0,
      state: 'partial',
    },
  ];
  let verifyCallCount = 0;
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: partialModels });
  });
  await page.route('**/models/partial-1/verify', async (route) => {
    if (route.request().method() === 'POST') {
      verifyCallCount += 1;
      await route.fulfill({ json: { valid: true, mismatches: [] } });
    }
  });

  await page.goto('/models.html');
  await page.waitForFunction(() => !!document.querySelector('[data-testid="route-ready"]'));
  await page.waitForTimeout(200);

  expect(verifyCallCount).toBeGreaterThanOrEqual(1);
});

test('HF dialog exposes Sign Out when token present and clears it', async ({ page }) => {
  let putValue: unknown;
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });
  await page.route('**/settings/hf_token_present', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { value?: unknown } | null;
      putValue = body?.value;
      await route.fulfill({ status: 204 });
    }
  });

  await page.goto('/models.html');

  await page.getByTestId('hf-login-button').click();
  await expect(page.getByTestId('hf-login-dialog')).toBeVisible();

  const signOut = page.getByTestId('hf-signout');
  await expect(signOut).toBeVisible();
  await signOut.click();

  await expect(page.locator('text=HuggingFace signed out')).toBeVisible();
  expect(putValue).toBe(false);
});

test('shows HuggingFace Login button in header', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });

  await page.goto('/models.html');

  await expect(page.getByTestId('hf-login-button')).toBeVisible();
});

test('saves HF token via vault when login dialog submitted', async ({ page }) => {
  let putValue: unknown;
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });
  await page.route('**/settings', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          hf_token_present: false,
          openrouter_key_present: false,
          first_run_completed: true,
          cpu_fallback_enabled: false,
          models_dir: '',
          default_model_id: '',
          theme: 'system',
        },
      });
    }
  });
  await page.route('**/settings/hf_token_present', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { value?: unknown } | null;
      putValue = body?.value;
      await route.fulfill({ status: 204 });
    }
  });

  await page.goto('/models.html');

  await expect(page.getByTestId('hf-login-dialog')).toBeVisible();
  await page.getByTestId('hf-login-input').fill('hf_test_xyz');
  await page.getByTestId('hf-login-save').click();

  await expect(page.locator('text=HuggingFace token saved')).toBeVisible();
  expect(putValue).toBe(true);
});

test('auto-opens HF login dialog when no token saved on mount', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });
  await page.route('**/settings', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          hf_token_present: false,
          openrouter_key_present: false,
          first_run_completed: true,
          cpu_fallback_enabled: false,
          models_dir: '',
          default_model_id: '',
          theme: 'system',
        },
      });
    }
  });

  await page.goto('/models.html');

  await expect(page.getByTestId('hf-login-dialog')).toBeVisible();
});

test('does NOT auto-open HF login dialog when token already saved', async ({ page }) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });

  await page.goto('/models.html');
  await page.waitForFunction(() => !!document.querySelector('[data-testid="route-ready"]'));
  await page.waitForTimeout(150);

  await expect(page.getByTestId('hf-login-dialog')).not.toBeVisible();
});

test('HF login dialog renders CLI instructions block with huggingface-cli command', async ({
  page,
}) => {
  await page.route('**/models', async (route) => {
    await route.fulfill({ json: mockModels });
  });

  await page.goto('/models.html');
  await page.getByTestId('hf-login-button').click();

  const instructions = page.getByTestId('hf-login-instructions');
  await expect(instructions).toBeVisible();
  await expect(instructions).toContainText('huggingface-cli');
  await expect(instructions).toContainText('login');
  await expect(instructions).toContainText('huggingface.co/settings/tokens');
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

test('verifies after download completes and navigates when all verified', async ({ page }) => {
  let modelsCall = 0;
  let verifyCalls = 0;
  await page.route('**/models', async (route) => {
    modelsCall += 1;
    if (modelsCall === 1) {
      await route.fulfill({
        json: [{ id: 'only', repo_id: 'org/only', name: 'Only', size_gb: 1, state: 'missing' }],
      });
    } else {
      await route.fulfill({
        json: [{ id: 'only', repo_id: 'org/only', name: 'Only', size_gb: 1, state: 'verified' }],
      });
    }
  });
  await page.route('**/models/only/download', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { job_id: 'job-x', state: 'queued' } });
    }
  });
  await page.route('**/models/jobs/job-x/events', async (route) => {
    const body =
      'event: progress\ndata: {"bytes_done":1024,"bytes_total":1024,"speed_mbps":2.5,"current_file":"all.bin","state":"completed"}\n\n';
    await route.fulfill({ contentType: 'text/event-stream', body });
  });
  await page.route('**/models/only/verify', async (route) => {
    if (route.request().method() === 'POST') {
      verifyCalls += 1;
      await route.fulfill({ json: { valid: true, mismatches: [] } });
    }
  });

  await page.goto('/models.html');
  await page.waitForFunction(() => !!document.querySelector('[data-testid="route-ready"]'));
  const card = page.locator('.flex-col').filter({ hasText: 'Only' });
  await card.getByRole('button', { name: 'Download' }).click();

  await page.waitForURL((url) => !url.pathname.includes('/models'), { timeout: 5000 });
  expect(verifyCalls).toBeGreaterThanOrEqual(1);
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
