import type { Protocol } from 'electron';

export const AUDIOMORPH_SCHEME = 'audiomorph';

export interface AudiomorphProtocolDeps {
  getApiBaseUrl: () => string;
  getApiToken: () => string;
  fetchImpl?: typeof fetch;
  logger?: (line: string) => void;
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
  const logger = deps.logger;
  logger?.(`[audiomorph] ${request.method} ${request.url} -> ${target}`);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': '*',
      },
    });
  }
  const headers = new Headers(request.headers);
  headers.set('X-Audiomorph-Token', deps.getApiToken());
  headers.delete('authorization');
  try {
    const upstream = await fetchImpl(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });
    logger?.(`[audiomorph] upstream ${upstream.status} ${target}`);
    const outHeaders = new Headers(upstream.headers);
    outHeaders.set('access-control-allow-origin', '*');
    outHeaders.set('access-control-expose-headers', '*');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.(`[audiomorph] upstream FAILED ${target}: ${msg}`);
    return new Response(`upstream error: ${msg}`, {
      status: 502,
      headers: { 'access-control-allow-origin': '*' },
    });
  }
}

export function registerAudiomorphProtocol(protocol: Protocol, deps: AudiomorphProtocolDeps): void {
  protocol.handle(AUDIOMORPH_SCHEME, (request) => handleAudiomorphRequest(request, deps));
}
