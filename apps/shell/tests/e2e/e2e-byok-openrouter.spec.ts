import { test, expect } from '@playwright/test';
import { launchAudiomorph, type AudiomorphE2EHandle } from './_setup';

const PLANTED_FAKE_TOKEN = 'sk-or-v1-PLANTED-FAKE-TEST-TOKEN';

test.describe('E2E: BYOK OpenRouter token handling', () => {
  let handle: AudiomorphE2EHandle;

  test.afterEach(async () => {
    if (handle) await handle.teardown();
  });

  test.fixme('planted OpenRouter token is scrubbed from sidecar diagnostics output', async () => {
    handle = await launchAudiomorph({
      AUDIOMORPH_OPENROUTER_TOKEN: PLANTED_FAKE_TOKEN,
    });

    const headers = { 'X-Audiomorph-Token': handle.sidecar.token };

    const diag = await fetch(`${handle.sidecar.baseUrl}/diagnostics`, { headers });
    if (diag.ok) {
      const text = await diag.text();
      expect(text).not.toContain(PLANTED_FAKE_TOKEN);
    }

    const health = await fetch(`${handle.sidecar.baseUrl}/healthz`, { headers });
    const healthText = await health.text();
    expect(healthText).not.toContain(PLANTED_FAKE_TOKEN);
  });

  test.fixme('sidecar rejects requests without X-Audiomorph-Token header', async () => {
    handle = await launchAudiomorph();

    const res = await fetch(`${handle.sidecar.baseUrl}/healthz`);
    expect([401, 403]).toContain(res.status);
  });
});
