import { test, expect } from '@playwright/test';
import { installElectronApiMock } from './_setup';

test.describe('PhaseIndicator', () => {
  test.beforeEach(async ({ page }) => {
    await installElectronApiMock(page);
    await page.route('**/models', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'model-1', name: 'Test Model 1', state: 'verified', role: 'generation' },
        ]),
      });
    });
    await page.route('**/jobs/generate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 'job-phase' }),
      });
    });
  });

  test('renders no AnimatedBeam stub text during a run', async ({ page }) => {
    await page.route('**/jobs/job-phase/events', async (route) => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: progress\ndata: {"phase":"loading","step":0,"total_steps":0,"eta_s":null}\n\n',
            ),
          );
          await new Promise((r) => setTimeout(r, 50));
          controller.close();
        },
      });
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: stream as unknown as Buffer,
      });
    });

    await page.goto('/');
    await page.fill(
      'textarea[placeholder="Describe the music you want to generate..."]',
      'Make some cool music',
    );
    await page.click('button[type="submit"]');
    await expect(page.getByTestId('phase-indicator')).toBeVisible();
    await expect(page.locator('text=Animated Beam')).toHaveCount(0);
  });

  test('each phase becomes active even when emitted back-to-back', async ({ page }) => {
    await page.route('**/jobs/job-phase/events', async (route) => {
      const phases = ['loading', 'generating', 'encoding', 'finalizing'];
      const body =
        phases
          .map(
            (p) =>
              `event: progress\ndata: {"phase":"${p}","step":0,"total_steps":0,"eta_s":null}\n\n`,
          )
          .join('') + 'event: done\ndata: {}\n\n';
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body,
      });
    });

    await page.goto('/');
    await page.fill(
      'textarea[placeholder="Describe the music you want to generate..."]',
      'Make some cool music',
    );

    await page.evaluate(() => {
      const w = window as unknown as { __observedPhases__: string[] };
      w.__observedPhases__ = [];
      const record = () => {
        for (const id of ['loading', 'generating', 'encoding', 'finalizing']) {
          const el = document.querySelector(`[data-testid="phase-step-${id}"]`);
          if (el?.getAttribute('data-active') === 'true' && !w.__observedPhases__.includes(id)) {
            w.__observedPhases__.push(id);
          }
        }
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, {
        attributes: true,
        subtree: true,
        childList: true,
        attributeFilter: ['data-active'],
      });
      const interval = window.setInterval(record, 50);
      window.setTimeout(() => {
        observer.disconnect();
        window.clearInterval(interval);
      }, 15000);
    });

    await page.click('button[type="submit"]');

    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as unknown as { __observedPhases__: string[] }).__observedPhases__.length,
          ),
        { timeout: 8000, intervals: [100] },
      )
      .toBeGreaterThanOrEqual(4);

    const observed = await page.evaluate(
      () => (window as unknown as { __observedPhases__: string[] }).__observedPhases__,
    );
    expect(observed).toEqual(['loading', 'generating', 'encoding', 'finalizing']);
  });
});
