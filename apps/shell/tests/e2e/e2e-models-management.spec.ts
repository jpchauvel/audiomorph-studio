import { test, expect } from '@playwright/test';
import { launchAudiomorph, type AudiomorphE2EHandle } from './_setup';

test.describe('E2E: models management', () => {
  let handle: AudiomorphE2EHandle;

  test.afterEach(async () => {
    if (handle) await handle.teardown();
  });

  test.fixme('lists, downloads, and removes a model — requires HF model cache, run in nightly CI only', async () => {
    handle = await launchAudiomorph();
    const headers = { 'X-Audiomorph-Token': handle.sidecar.token };

    const list = await fetch(`${handle.sidecar.baseUrl}/models`, { headers });
    expect(list.status).toBe(200);
    const items = await list.json();
    expect(Array.isArray(items)).toBe(true);
  });
});
