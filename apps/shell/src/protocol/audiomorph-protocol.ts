import type { Protocol } from 'electron';

export const AUDIOMORPH_SCHEME = 'audiomorph';

export interface AudiomorphProtocolDeps {
  getApiBaseUrl: () => string;
  getApiToken: () => string;
  fetchImpl?: typeof fetch;
}

export function buildAudiomorphTargetUrl(requestUrl: string, apiBaseUrl: string): string {
  const prefix = `${AUDIOMORPH_SCHEME}://`;
  if (!requestUrl.startsWith(prefix)) {
    throw new Error(`unexpected protocol url: ${requestUrl}`);
  }
  const rest = requestUrl.slice(prefix.length);
  const base = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  return `${base}/${rest}`;
}

export async function handleAudiomorphRequest(
  request: Request,
  deps: AudiomorphProtocolDeps,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const target = buildAudiomorphTargetUrl(request.url, deps.getApiBaseUrl());
  const headers = new Headers(request.headers);
  headers.set('X-Audiomorph-Token', deps.getApiToken());
  headers.delete('authorization');
  return fetchImpl(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  });
}

export function registerAudiomorphProtocol(protocol: Protocol, deps: AudiomorphProtocolDeps): void {
  protocol.handle(AUDIOMORPH_SCHEME, (request) => handleAudiomorphRequest(request, deps));
}
