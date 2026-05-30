import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(configDir, '..', '..');

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  // `output: 'export'` + `assetPrefix: './'` are required for the final
  // Electron `file://` bundle, but they break SSR hydration when served
  // over `http://localhost:3000` during `pnpm dev` (relative chunk URLs
  // confuse the Next.js client runtime and React never hydrates).
  // Gate them to production builds only.
  ...(isProd
    ? {
        output: 'export' as const,
        assetPrefix: './',
      }
    : {}),
  images: { unoptimized: true },
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
