#!/usr/bin/env node
/**
 * Tiny cross-platform URL readiness poller.
 *
 * Replaces `wait-on` in the dev script, which exits with code 1 against
 * Next.js 16 dev server even though renderer responds 200 OK — `wait-on`
 * 8.0.5 + axios interacts badly with concurrent in-flight first-compile
 * requests, producing false negatives within ~6s.
 *
 * Usage: node scripts/wait-for-url.mjs <url> [timeoutMs] [intervalMs]
 *
 * Exits 0 on first 2xx/3xx response, 1 on timeout.
 */
import http from 'node:http';
import https from 'node:https';

const url = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 60_000);
const intervalMs = Number(process.argv[4] ?? 500);

if (!url) {
  console.error('usage: wait-for-url.mjs <url> [timeoutMs] [intervalMs]');
  process.exit(2);
}

const client = url.startsWith('https:') ? https : http;
const deadline = Date.now() + timeoutMs;

const verbose = process.env.WAIT_FOR_URL_VERBOSE === '1';
function probe() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = client.get(url, { timeout: 5_000 }, (res) => {
      res.resume();
      const ok = res.statusCode != null && res.statusCode < 400;
      if (verbose)
        console.error(`[wait-for-url] status=${res.statusCode} ok=${ok} t=${Date.now() - t0}ms`);
      resolve(ok);
    });
    req.on('error', (err) => {
      if (verbose)
        console.error(`[wait-for-url] error=${err.code ?? err.message} t=${Date.now() - t0}ms`);
      resolve(false);
    });
    req.on('timeout', () => {
      if (verbose) console.error(`[wait-for-url] timeout t=${Date.now() - t0}ms`);
      req.destroy();
      resolve(false);
    });
  });
}

(async () => {
  while (Date.now() < deadline) {
    if (await probe()) {
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error(`wait-for-url: timeout after ${timeoutMs}ms waiting for ${url}`);
  process.exit(1);
})();
