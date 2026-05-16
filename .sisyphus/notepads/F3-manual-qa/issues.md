# F3 Manual QA — Issues

## Failing Playwright tests (4/25)
1. `export.spec.ts:23` — Export Dialog: bitrate/mp3 flow
2. `models.spec.ts:73` — handles verify action
3. `player.spec.ts:8` — Player Component: getByPlaceholder('Describe the sound...') never resolves (likely missing data-testid/placeholder on main generate input)
4. `settings.spec.ts:44` — `locator('text=Models')` strict-mode violation (4 matches). Test needs more specific locator.

## Security violations
- `app/settings/page.tsx` makes **5 raw fetches** to `http://127.0.0.1:8000/...` directly, bypassing `window.__AUDIOMORPH_API_BASE__`.
  Other pages (`page.tsx`, `lyrics/page.tsx`, `models/page.tsx`, `first-run/page.tsx`, `prompt-assist/Drawer.tsx`) correctly use `API_BASE()` helper.

## Minor
- `components/magicui/shimmer-button.tsx` uses raw `#ffffff` and `rgba(0,0,0,1)` as prop defaults (3rd-party component, low impact but technically violates "OKLCH only" rule).

## Structure note
- Plan referenced `library/page.tsx` but project uses different IA: `models`, `lyrics`, `diagnostics`. Equivalent functionality covered.
