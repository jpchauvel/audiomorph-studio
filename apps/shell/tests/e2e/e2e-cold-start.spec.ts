import { test, expect } from '@playwright/test';
import { launchAudiomorph, type AudiomorphE2EHandle } from './_setup';

test.describe('E2E: cold start', () => {
  let handle: AudiomorphE2EHandle;

  test.afterEach(async () => {
    if (handle) await handle.teardown();
  });

  test.fixme('launches shell, sidecar healthy on test-mode port, first window ready', async () => {
    handle = await launchAudiomorph();

    expect(handle.sidecar.port).toBeGreaterThan(0);
    expect(handle.sidecar.token).toMatch(/.+/);

    const health = await fetch(`${handle.sidecar.baseUrl}/healthz`, {
      headers: { 'X-Audiomorph-Token': handle.sidecar.token },
    });
    expect(health.status).toBe(200);

    const win = handle.window as unknown as import('@playwright/test').Page;
    await win.waitForSelector('[data-testid="route-ready"]', {
      state: 'attached',
      timeout: 30_000,
    });
  });
});
