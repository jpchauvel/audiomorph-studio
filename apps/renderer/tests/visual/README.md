# Visual Regression Suite

Pixel-diff regression checks for every Next.js route under `apps/renderer/app/`
× `{light, dark}` themes, with per-platform baseline isolation.

## Layout

```
tests/visual/
├── routes.spec.ts                    # static ROUTES list × THEMES matrix
├── __snapshots__/
│   └── {darwin|win32|linux}/
│       └── routes.spec.ts/
│           ├── root-light.png
│           ├── root-dark.png
│           ├── lyrics-light.png
│           ├── lyrics-dark.png
│           └── ...
└── README.md
```

Baselines are stored per-OS via `snapshotPathTemplate: '{testDir}/__snapshots__/{platform}/{testFilePath}/{arg}{ext}'`
in `playwright.visual.config.ts`. **Do not share baselines across platforms** —
each OS rasterizes fonts and antialiasing differently.

## Conventions

- Each route page renders a hidden `<span data-testid="route-ready" />` sentinel
  inside its top-level wrapper, marked with the `// AUDIOMORPH_TEST_MODE hook`
  comment. The spec waits for this sentinel before snapshotting.
- Theme is applied at runtime via `document.documentElement.setAttribute('data-theme', theme)`.
  The default in `app/layout.tsx` is `data-theme="dark"`.
- Any DOM marked `data-volatile` (timestamps, random IDs, live counters) is
  masked from the snapshot to prevent false diffs.
- Tolerances: `threshold: 0.2`, `maxDiffPixelRatio: 0.01`. Animations and carets
  are disabled; viewport is locked to `1440×900`.

## Local Workflow

```bash
# 1. Build the renderer (static export to apps/renderer/out/)
cd apps/renderer && pnpm build

# 2. Generate / refresh baselines for your current platform
pnpm test:visual:update

# 3. Run the suite — expect 0 diffs against committed baselines
pnpm test:visual
```

The local `webServer` config will reuse an existing dev/preview server when
present (`reuseExistingServer: !process.env.CI`). In CI it always starts
its own `bun x serve@latest out -l 3000` instance.

## CI Workflow (T23 follow-up)

- Visual baselines are **never auto-updated on main push**.
- Updates flow through a dedicated workflow that opens a PR:
  - Developer triggers `workflow_dispatch` with target platform.
  - Workflow runs `pnpm test:visual:update`, commits the new PNGs to a
    branch, and opens a PR labeled `visual-baseline-update`.
  - Reviewer eyeballs the diff in the PR's "Files changed" tab.
  - After merge, subsequent runs on main re-verify against the new baselines.

## Regression Detection

To confirm the suite actually catches regressions:

1. Temporarily change an OKLCH token in `app/globals.css` (e.g.,
   `--color-primary: oklch(80% 0.22 30)`).
2. Rebuild: `cd apps/renderer && pnpm build`.
3. Run: `pnpm test:visual`.
4. Expect at least one failure with a `*-actual.png` + `*-diff.png` in
   `playwright-report/`.
5. Revert the change.

## Adding a New Route

1. Add `<span hidden data-testid="route-ready" />` inside the new page's
   top-level wrapper (with `// AUDIOMORPH_TEST_MODE hook` comment).
2. Append `{ slug, path }` to `ROUTES` in `routes.spec.ts`.
3. Run `pnpm test:visual:update` to generate baselines.
