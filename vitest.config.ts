import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared-types/vitest.config.ts',
  'packages/platform/vitest.config.ts',
  'packages/ui/vitest.config.ts',
]);
