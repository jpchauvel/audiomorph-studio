# Release Checklist

This document outlines the manual steps required to release AudioMorph Studio.

## Pre-Release

- [ ] Ensure all tests pass locally: `pnpm test`
- [ ] Verify shell tests specifically: `cd apps/shell && npx vitest run`
- [ ] Update version in root `package.json` (e.g., `0.1.0` → `0.2.0`)
- [ ] Run version stamping: `bun scripts/stamp-version.ts`
- [ ] Verify all workspace `package.json` files and `apps/sidecar/pyproject.toml` were updated
- [ ] Verify `apps/renderer/src/version.ts` and `apps/shell/src/version.ts` were created/updated
- [ ] Regenerate icons if needed (design changes): `pnpm run build:icons` (if script exists)
- [ ] Commit version changes: `git add . && git commit -m "chore(release): bump version to X.Y.Z"`

## Platform Smoke Tests

Before pushing the release tag, perform smoke tests on all three target platforms:

### macOS (Apple Silicon)

- [ ] Build locally: `pnpm run dist:mac` (requires signing secrets)
- [ ] Launch the .dmg installer
- [ ] Verify app launches and loads the renderer
- [ ] Check `/healthz` endpoint responds with correct version
- [ ] Verify sidecar process starts and logs appear in `~/Library/Application Support/AudioMorph Studio/logs/`

### Windows (x64)

- [ ] Build locally: `pnpm run dist:win`
- [ ] Run the .exe installer
- [ ] Verify app launches and loads the renderer
- [ ] Check `/healthz` endpoint responds with correct version
- [ ] Verify sidecar process starts and logs appear in `%APPDATA%\AudioMorph Studio\logs\`

### Linux (x64)

- [ ] Build locally: `pnpm run dist:linux`
- [ ] Install .deb: `sudo dpkg -i dist/audiomorph-studio-*.deb`
- [ ] Launch app from applications menu or `audiomorph-studio` CLI
- [ ] Verify app launches and loads the renderer
- [ ] Check `/healthz` endpoint responds with correct version
- [ ] Verify sidecar process starts and logs appear in `~/.local/share/AudioMorph Studio/logs/`

## Release Tag & GitHub Actions

- [ ] Push version commit: `git push origin main`
- [ ] Create and push release tag: `git tag v0.2.0 && git push origin v0.2.0`
- [ ] Monitor GitHub Actions workflow at `.github/workflows/release.yml`
  - [ ] macOS build completes successfully
  - [ ] Windows build completes successfully
  - [ ] Linux build completes successfully
  - [ ] Release job aggregates artifacts and generates `SHA256SUMS.txt`
  - [ ] GitHub Release is created as DRAFT (not auto-published)

## Post-Release

- [ ] Download `SHA256SUMS.txt` from draft release
- [ ] Verify checksums locally:
  ```bash
  cd dist
  shasum -a 256 -c ../SHA256SUMS.txt
  ```
- [ ] Review release notes and artifacts in draft release
- [ ] Manually publish the release (click "Publish release" button on GitHub)
- [ ] Announce release on project channels

## Rollback

If issues are discovered after release:

- [ ] Delete the GitHub Release (if not yet published)
- [ ] Delete the git tag: `git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`
- [ ] Revert version commit: `git revert <commit-hash>`
- [ ] Investigate and fix issues
- [ ] Restart from Pre-Release section with corrected code
