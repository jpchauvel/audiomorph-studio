// AUDIOMORPH_TEST_MODE hook
export function getApiBase(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:8000';
  }

  const testMode = (window as any).__AUDIOMORPH_TEST_MODE__;
  if (testMode) {
    return (window as any).__AUDIOMORPH_API_BASE__ || 'http://localhost:8000';
  }

  return (window as any).__AUDIOMORPH_API_BASE__ || 'http://localhost:8000';
}
