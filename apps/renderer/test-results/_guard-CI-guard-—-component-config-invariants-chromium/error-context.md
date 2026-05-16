# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: _guard.spec.ts >> CI guard — component config invariants
- Location: tests/component/_guard.spec.ts:3:5

# Error details

```
Error: AUDIOMORPH_TEST_MODE must be undefined or "1", got: "wrong"

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('CI guard — component config invariants', async ({ page }) => {
  4  |   const mode = process.env.AUDIOMORPH_TEST_MODE;
  5  |   const validMode = mode === undefined || mode === '1';
> 6  |   expect(validMode, `AUDIOMORPH_TEST_MODE must be undefined or "1", got: ${JSON.stringify(mode)}`).toBe(true);
     |                                                                                                    ^ Error: AUDIOMORPH_TEST_MODE must be undefined or "1", got: "wrong"
  7  | 
  8  |   await page.goto('/');
  9  | 
  10 |   const ipcProbe = await page.evaluate(() => {
  11 |     const ipc = (window as unknown as { __AUDIOMORPH_IPC__?: unknown }).__AUDIOMORPH_IPC__;
  12 |     return { defined: ipc !== undefined, type: typeof ipc };
  13 |   });
  14 |   expect(['undefined', 'object', 'function']).toContain(ipcProbe.type);
  15 | 
  16 |   const integrationLeak = await page.evaluate(() => {
  17 |     return (window as unknown as { __AUDIOMORPH_INTEGRATION_SETUP__?: unknown }).__AUDIOMORPH_INTEGRATION_SETUP__;
  18 |   });
  19 |   expect(integrationLeak).toBeUndefined();
  20 | });
  21 | 
```