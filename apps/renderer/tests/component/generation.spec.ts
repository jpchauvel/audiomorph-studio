import { test, expect } from '@playwright/test';
import { installElectronApiMock } from './_setup';

test.describe('Generation Studio', () => {
  test.beforeEach(async ({ page }) => {
    await installElectronApiMock(page);
    await page.route('**/models', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'model-1', name: 'Test Model 1', state: 'verified' },
          { id: 'model-2', name: 'Test Model 2', state: 'missing' },
        ]),
      });
    });

    await page.goto('/');
  });

  test('form renders with verified models', async ({ page }) => {
    await expect(page.locator('text=AudioMorph Studio').first()).toBeVisible();
    await expect(page.locator('text=Generate')).toBeVisible();
  });

  test('empty state when no verified models', async ({ page }) => {
    await page.route('**/models', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'model-2', name: 'Test Model 2', state: 'missing' }]),
      });
    });
    await page.goto('/');

    await expect(page.locator('text=No models downloaded yet')).toBeVisible();
    await expect(page.locator('text=Go to Models')).toBeVisible();
  });

  test('reverifies partial models on mount and shows generation form (no Go to Models)', async ({
    page,
  }) => {
    let modelsHits = 0;
    let verifyHits = 0;
    await page.route('**/models', async (route) => {
      modelsHits += 1;
      const state = modelsHits === 1 ? 'partial' : 'verified';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'mm-1', name: 'Mock Model', state }]),
      });
    });
    await page.route('**/models/mm-1/verify', async (route) => {
      if (route.request().method() === 'POST') {
        verifyHits += 1;
        await route.fulfill({ json: { valid: true, mismatches: [] } });
      }
    });

    await page.goto('/');

    await expect(page.locator('text=Generate')).toBeVisible();
    await expect(page.locator('text=Go to Models')).not.toBeVisible();
    expect(verifyHits).toBeGreaterThanOrEqual(1);
  });

  test('Go to Models empty state only when manifest has zero models at all', async ({ page }) => {
    await page.route('**/models', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
    await page.goto('/');

    await expect(page.locator('text=No models downloaded yet')).toBeVisible();
    await expect(page.locator('text=Go to Models')).toBeVisible();
  });

  test('submit flow with mocked SSE phase transitions', async ({ page }) => {
    await page.route('**/jobs/generate', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      expect(body.prompt).toBe('Make some cool music');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 'job-123' }),
      });
    });

    await page.route('**/jobs/job-123/events', async (route) => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: progress\ndata: {"phase":"loading","step":0,"total_steps":0,"eta_s":null}\n\n',
            ),
          );
        },
      });
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: stream as unknown as Buffer,
      });
    });

    await page.fill(
      'textarea[placeholder="Describe the music you want to generate..."]',
      'Make some cool music',
    );
    await page.click('button[type="submit"]');

    await expect(page.locator('text=Cancel Generation')).toBeVisible();
  });

  test('prompt logic works', async ({ page }) => {
    await expect(page.locator('button[type="submit"]')).toBeDisabled();

    await page.fill('textarea[id="prompt"]', 'A cool song');
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    await expect(page.locator('text=11/2000')).toBeVisible();
  });
});
