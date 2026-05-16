import { test, expect, type Request } from '@playwright/test';
import { launchAudiomorph, type AudiomorphE2EHandle } from './_setup';

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);
const ALLOWED_SCHEMES = new Set(['file:', 'data:', 'chrome:', 'devtools:', 'about:']);

test.describe('E2E: no network leak', () => {
  let handle: AudiomorphE2EHandle;

  test.afterEach(async () => {
    if (handle) await handle.teardown();
  });

  test.fixme('renderer makes zero external network requests on cold start', async () => {
    handle = await launchAudiomorph();
    const win = handle.window as unknown as import('@playwright/test').Page;

    const offending: string[] = [];
    const monitor = (req: Request) => {
      const url = req.url();
      try {
        const u = new URL(url);
        if (ALLOWED_SCHEMES.has(u.protocol)) return;
        if ((u.protocol === 'http:' || u.protocol === 'https:') && ALLOWED_HOSTS.has(u.hostname))
          return;
        offending.push(url);
      } catch {
        offending.push(url);
      }
    };
    win.on('request', monitor);

    await win.waitForSelector('[data-testid="route-ready"]', {
      state: 'attached',
      timeout: 30_000,
    });

    win.off('request', monitor);
    expect(offending, `unexpected external requests: ${offending.join(', ')}`).toEqual([]);
  });
});
