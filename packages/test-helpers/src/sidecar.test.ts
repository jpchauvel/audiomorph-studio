import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as http from 'node:http';

import {
  spawnSidecar,
  SidecarHandshakeTimeout,
  SidecarHandshakeError,
} from './sidecar.js';
import { TEST_TOKEN } from './test-mode.js';

function makeMockSidecarScript(body: string): { bin: string; args: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'sidecar-mock-'));
  const file = join(dir, 'mock_sidecar.py');
  writeFileSync(file, body, { mode: 0o755 });
  chmodSync(file, 0o755);
  return { bin: 'python3', args: [file] };
}

describe('sidecar helper', () => {
  it('spawn + handshake + kill cycle with mock sidecar', async () => {
    const script = `
import json, sys, time, socket
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.bind(('127.0.0.1', 0))
sock.listen(1)
port = sock.getsockname()[1]
sys.stdout.write(json.dumps({"event":"listening","port":port,"token":"${TEST_TOKEN}"}) + "\\n")
sys.stdout.flush()
while True:
    time.sleep(1)
`;
    const mock = makeMockSidecarScript(script);
    const handle = await spawnSidecar({
      timeoutMs: 10_000,
      extraEnv: {
        AUDIOMORPH_TEST_SPAWN_BIN: mock.bin,
        AUDIOMORPH_TEST_SPAWN_CMD: JSON.stringify(mock.args),
      },
    });

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.token).toBe(TEST_TOKEN);
    expect(handle.baseUrl).toBe(`http://127.0.0.1:${handle.port}`);
    expect(typeof handle.proc.pid).toBe('number');

    const pid = handle.proc.pid!;
    await handle.kill();

    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  }, 20_000);

  it('throws SidecarHandshakeTimeout when handshake never arrives', async () => {
    const script = `
import time
while True:
    time.sleep(1)
`;
    const mock = makeMockSidecarScript(script);
    const start = Date.now();
    await expect(
      spawnSidecar({
        timeoutMs: 500,
        extraEnv: {
          AUDIOMORPH_TEST_SPAWN_BIN: mock.bin,
          AUDIOMORPH_TEST_SPAWN_CMD: JSON.stringify(mock.args),
        },
      })
    ).rejects.toBeInstanceOf(SidecarHandshakeTimeout);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);

  it('throws SidecarHandshakeError on token mismatch and cleans up child', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'sidecar-pid-')), 'pid.txt');
    const script = `
import json, sys, os
with open(${JSON.stringify(pidFile)}, "w") as f:
    f.write(str(os.getpid()))
sys.stdout.write(json.dumps({"event":"listening","port":12345,"token":"wrong-token"}) + "\\n")
sys.stdout.flush()
import time
while True:
    time.sleep(1)
`;
    const mock = makeMockSidecarScript(script);
    await expect(
      spawnSidecar({
        timeoutMs: 5_000,
        extraEnv: {
          AUDIOMORPH_TEST_SPAWN_BIN: mock.bin,
          AUDIOMORPH_TEST_SPAWN_CMD: JSON.stringify(mock.args),
        },
      })
    ).rejects.toBeInstanceOf(SidecarHandshakeError);

    await new Promise((r) => setTimeout(r, 500));
    const fs = await import('node:fs');
    const childPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    expect(Number.isFinite(childPid)).toBe(true);
    let alive = true;
    try {
      process.kill(childPid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  }, 10_000);
});
