import { describe, expect, it, vi } from 'vitest';
import {
  AUDIOMORPH_SCHEME,
  buildAudiomorphTargetUrl,
  handleAudiomorphRequest,
} from '../../src/protocol/audiomorph-protocol';

describe('audiomorph protocol', () => {
  it('rewrites audiomorph:// urls to the sidecar base url', () => {
    const target = buildAudiomorphTargetUrl(
      'audiomorph://jobs/abc/audio',
      'http://127.0.0.1:51234',
    );
    expect(target).toBe('http://127.0.0.1:51234/jobs/abc/audio');
  });

  it('trims trailing slash on base url', () => {
    const target = buildAudiomorphTargetUrl(
      'audiomorph://jobs/abc/audio',
      'http://127.0.0.1:51234/',
    );
    expect(target).toBe('http://127.0.0.1:51234/jobs/abc/audio');
  });

  it('rejects non-audiomorph urls', () => {
    expect(() => buildAudiomorphTargetUrl('http://example.com/x', 'http://127.0.0.1:1')).toThrow();
  });

  it('proxies request to sidecar with X-Audiomorph-Token and strips Authorization', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(`OK ${String(input)}`, {
        status: 200,
        headers: { 'content-type': 'audio/wav', 'x-seen-token': String((init?.headers as Headers).get('X-Audiomorph-Token')) },
      });
    });

    const req = new Request('audiomorph://jobs/abc/audio', {
      method: 'GET',
      headers: { Authorization: 'Bearer leaked' },
    });

    const res = await handleAudiomorphRequest(req, {
      getApiBaseUrl: () => 'http://127.0.0.1:51234',
      getApiToken: () => 'secret-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK http://127.0.0.1:51234/jobs/abc/audio');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('content-type')).toBe('audio/wav');
    const callArgs = fetchImpl.mock.calls[0];
    expect(callArgs).toBeDefined();
    const sentHeaders = (callArgs![1] as RequestInit).headers as Headers;
    expect(sentHeaders.get('X-Audiomorph-Token')).toBe('secret-token');
    expect(sentHeaders.get('authorization')).toBeNull();
  });

  it('short-circuits OPTIONS preflight with permissive CORS headers', async () => {
    const fetchImpl = vi.fn();
    const req = new Request('audiomorph://jobs/abc/audio', { method: 'OPTIONS' });
    const res = await handleAudiomorphRequest(req, {
      getApiBaseUrl: () => 'http://127.0.0.1:51234',
      getApiToken: () => 'secret-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exposes the scheme constant', () => {
    expect(AUDIOMORPH_SCHEME).toBe('audiomorph');
  });
});
