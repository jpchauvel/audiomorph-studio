# CI Cost Guards

Reference for understanding, monitoring, and controlling GitHub Actions spend.

## Estimated Monthly Cost

| Workflow                | Trigger   | OS      | Minutes/run | Multiplier | Runs/month (est.) | Cost/month (est.) |
| ----------------------- | --------- | ------- | ----------- | ---------- | ----------------- | ----------------- |
| test-pr                 | PR push   | Linux   | ~12         | 1×         | ~80               | ~16 min           |
| test-main               | main push | Linux   | ~25         | 1×         | ~20               | ~8 min            |
| test-nightly            | schedule  | Linux   | ~30         | 1×         | ~30               | ~15 min           |
| test-nightly            | schedule  | macOS   | ~30         | 10×        | ~30               | ~150 min          |
| test-nightly            | schedule  | Windows | ~30         | 2×         | ~30               | ~30 min           |
| update-visual-baselines | manual    | all 3   | ~40         | varies     | ~2                | ~10 min           |

> GitHub Actions free tier: 2,000 min/month (public repos: unlimited).
> macOS runners cost 10× Linux; Windows 2× Linux.

## Concurrency

Each workflow has a `concurrency` group to prevent redundant runs:

| Workflow                | Group key                      | cancel-in-progress                           |
| ----------------------- | ------------------------------ | -------------------------------------------- |
| test-pr                 | `pr-${{ github.ref }}`         | `true` — cancels superseded PR runs          |
| test-main               | `main-${{ github.sha }}`       | `false` — never cancel a main run mid-flight |
| test-nightly            | `nightly-${{ github.run_id }}` | `false` — each nightly is independent        |
| update-visual-baselines | `visual-update-${{ branch }}`  | `false` — never cancel a baseline commit     |

**Why cancel-in-progress: false on main/nightly?**
Cancelling a mid-flight run loses test artifacts and JUnit XML reports that CI depends on.

## Investigation

When a workflow exceeds its time budget:

1. Open the run in GitHub Actions UI → identify the slowest job/step.
2. Check HF model cache: if `Restore HF model cache` shows `Cache Miss`, models are being re-downloaded (~10 min). Fix: ensure `apps/sidecar/scripts/required-models.json` hasn't changed unexpectedly.
3. Check for flaky E2E tests: look for retried steps in the nightly matrix.
4. For PR tier >15 min: check if `paths-ignore` is working — a docs-only PR should skip the workflow entirely.
5. Run `pnpm ci:hf:key` locally to verify the cache key matches what CI expects.

## Kill-Switch

To disable a workflow in <30 seconds:

1. Go to **Actions** tab in the GitHub repository.
2. Select the workflow (e.g., `test-nightly`).
3. Click **"..."** (three dots) → **"Disable workflow"**.
4. The workflow will no longer trigger until re-enabled.

To re-enable: same path → **"Enable workflow"**.

> For emergency spend control, disable `test-nightly` first (highest cost due to macOS runners).
