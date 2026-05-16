import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { launchAudiomorph, type AudiomorphE2EHandle } from './_setup';

test.describe('E2E: real-engine transcribe', () => {
  let handle: AudiomorphE2EHandle;

  test.afterEach(async () => {
    if (handle) await handle.teardown();
  });

  test.fixme('transcribes speech-3s.wav via real Whisper — requires HF model cache, run in nightly CI only', async () => {
    handle = await launchAudiomorph();
    const fixture = path.resolve(
      __dirname,
      '../../../../packages/test-helpers/fixtures/audio/speech-3s.wav',
    );
    const audio = fs.readFileSync(fixture);
    const form = new FormData();
    form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'speech-3s.wav');

    const res = await fetch(`${handle.sidecar.baseUrl}/transcribe`, {
      method: 'POST',
      headers: { 'X-Audiomorph-Token': handle.sidecar.token },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
  });
});
