## [2026-05-16] Session Init

- No issues yet — Phase 0 starting

## [2026-05-16] Renderer blocking violations resolution

- Fixed 5 hardcoded settings fetch URLs by introducing `API_BASE()`/`TOKEN()`/`headers()` in `app/settings/page.tsx`; all settings fetches now use dynamic base URL + `X-Audiomorph-Token`.
- Removed forbidden `next/font/google` Geist usage from `app/layout.tsx`; kept `geist/font/sans` + `geist/font/mono` package imports only.
- Updated `ShimmerButton` defaults to OKLCH tokens (`oklch(1 0 0)` and `oklch(0 0 0)`).
- Deleted empty stub workspaces `apps/desktop` and `apps/web`; removed them from root workspaces and `pnpm-workspace.yaml`.
- Repaired failing Playwright specs:
  - `settings.spec.ts`: static-export path (`/settings.html`) + non-strict locators + URL-agnostic route/request matching.
  - `player.spec.ts`: corrected prompt placeholder and mocked generation + SSE done event.
  - `export.spec.ts`: made flow deterministic by creating a completed generation via mocked `/jobs/generate` + SSE, then asserting export dialog behavior.
  - `models.spec.ts`: removed custom spawned static server (use Playwright webServer), fixed verify route/card target by using a `partial` model for verify action.
- Verification: `bunx playwright test` (25/25 passing) and `bun run build` both pass in `apps/renderer`.
