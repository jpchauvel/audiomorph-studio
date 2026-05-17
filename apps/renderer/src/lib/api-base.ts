// AUDIOMORPH_TEST_MODE hook
declare global {
  interface Window {
    __AUDIOMORPH_TEST_MODE__?: boolean;
    __AUDIOMORPH_API_BASE__?: string;
  }
}

export function getApiBase(): string {
  if (typeof window !== 'undefined' && window.__AUDIOMORPH_TEST_MODE__) {
    const base = window.__AUDIOMORPH_API_BASE__;
    if (typeof base === 'string' && base.length > 0) return base;
  }
  throw new Error(
    'getApiBase() is forbidden in production — use window.electronAPI.request / .stream. ' +
      'The renderer must not address the sidecar directly.',
  );
}
