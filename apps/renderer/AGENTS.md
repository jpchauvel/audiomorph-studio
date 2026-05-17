<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

---

# apps/renderer — Next.js 16 Renderer

UI-only React app. Talks to Electron main via `window.electronAPI` (preload-injected). Never talks to sidecar directly.

Root context: `/AGENTS.md`. Shell context: `apps/shell/AGENTS.md`.

## API Discovery

- `src/lib/api-base.ts` `getApiBase()` reads `window.__AUDIOMORPH_API_BASE__` (preload-injected by shell, or test-injected).
- Most code uses `window.electronAPI.request(...)` which proxies via main → sidecar with `X-Audiomorph-Token`. Renderer NEVER sees the token.
- For tests: `tests/integration/_setup.ts` `installRendererBootstrap()` does `page.addInitScript` to set `window.__AUDIOMORPH_API_BASE__` + `window.__AUDIOMORPH_TOKEN__`.

## Path Alias

`@/*` → `./*` (renderer root only). NOT `@audiomorph/*` — those resolve via pnpm workspace.

## Tests

| Layer       | Dir                  | Command                 | Config                                                                         |
| ----------- | -------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Component   | `tests/component/`   | `pnpm test:component`   | `playwright.component.config.ts`                                               |
| Integration | `tests/integration/` | `pnpm test:integration` | `playwright.integration.config.ts` (uses spawned sidecar via test-helpers)     |
| Visual      | `tests/visual/`      | `pnpm test:visual`      | `playwright.visual.config.ts`; baselines per-OS in `__snapshots__/{platform}/` |

Visual baselines are CI-managed. **NEVER `pnpm test:visual:update` for a PR** — only for local triage. See `tests/visual/README.md`.

## Install Quirks

`package.json` sets `ignoreScripts` + `trustedDependencies` for `sharp` and `unrs-resolver` (native binaries).

## Must Not

- NEVER hardcode `http://127.0.0.1:PORT` — always `getApiBase()` or `window.electronAPI.*`.
- NEVER persist secrets to localStorage/sessionStorage/IndexedDB/cookies/Zustand-persist. Vault lives in main process via `window.electronAPI.vault.*`.
- NEVER render raw API keys after save — mask only.
- No raw colors — OKLCH design tokens only.
- No Google Fonts URL imports — `geist` npm package only.
- React function components + hooks only. No class components.
