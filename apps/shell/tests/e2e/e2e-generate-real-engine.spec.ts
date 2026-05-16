import { test, expect } from '@playwright/test';
import { launchAudiomorph, type AudiomorphE2EHandle } from './_setup';

test.describe('E2E: real-engine generate', () => {
  let handle: AudiomorphE2EHandle;

  test.afterEach(async () => {
    if (handle) await handle.teardown();
  });

  test.fixme('generates audio via real engine — requires HF model cache, run in nightly CI only', async () => {
    handle = await launchAudiomorph();
    const headers = {
      'X-Audiomorph-Token': handle.sidecar.token,
      'Content-Type': 'application/json',
    };

    const res = await fetch(`${handle.sidecar.baseUrl}/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'a short ambient pad', duration_s: 2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('audio_url');
  });
});
