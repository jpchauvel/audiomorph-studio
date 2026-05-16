#!/usr/bin/env node
/**
 * Posts (or updates) a PR comment summarizing Playwright visual-regression
 * diffs. Walks `apps/renderer/tests/visual/__snapshots__/<platform>/test-results/`
 * for `*-diff.png` artifacts produced by Playwright on snapshot mismatch.
 *
 * Modes:
 *   - Local (no GITHUB_TOKEN or no GITHUB_PR_NUMBER): print to stdout, exit 0.
 *   - CI (both present): create or update a comment on the PR via
 *     `gh api`. Comment is keyed by the marker `<!-- audiomorph-visual-bot -->`
 *     for idempotency across runs.
 *
 * Never fails the CI run: comment API errors are warnings.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  ".."
);
const SNAPSHOTS_ROOT = path.join(
  REPO_ROOT,
  "apps",
  "renderer",
  "tests",
  "visual",
  "__snapshots__"
);
const MARKER = "<!-- audiomorph-visual-bot -->";

/**
 * Walk every `<platform>/test-results/` subtree under SNAPSHOTS_ROOT and
 * collect files whose names end in `-diff.png`. Returns relative paths
 * (from REPO_ROOT) for stable reporting.
 */
async function findDiffs() {
  const diffs = [];
  let platforms;
  try {
    platforms = await fs.readdir(SNAPSHOTS_ROOT, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return diffs;
    throw err;
  }
  for (const platform of platforms) {
    if (!platform.isDirectory()) continue;
    const testResults = path.join(SNAPSHOTS_ROOT, platform.name, "test-results");
    let entries;
    try {
      entries = await fs.readdir(testResults, {
        recursive: true,
        withFileTypes: true,
      });
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith("-diff.png")) continue;
      const parent = entry.parentPath ?? entry.path ?? testResults;
      const full = path.join(parent, entry.name);
      diffs.push({
        platform: platform.name,
        file: entry.name,
        relPath: path.relative(REPO_ROOT, full),
      });
    }
  }
  return diffs;
}

/** Best-effort split of "route-theme-diff.png" → {route, theme}. */
function parseDiffName(name) {
  const base = name.replace(/-diff\.png$/, "");
  const parts = base.split("-");
  if (parts.length >= 2) {
    const theme = parts.pop();
    const route = parts.join("-");
    return { route, theme };
  }
  return { route: base, theme: "" };
}

function buildCommentBody(diffs) {
  if (diffs.length === 0) {
    return `${MARKER}\n✅ Visual regression: 0 diffs detected`;
  }
  const rows = diffs
    .map((d) => {
      const { route, theme } = parseDiffName(d.file);
      return `| \`${route}\` | \`${theme}\` | \`${d.relPath}\` |`;
    })
    .join("\n");
  return [
    MARKER,
    `⚠️ Visual regression: ${diffs.length} diff(s) found`,
    "",
    "| Route | Theme | Diff |",
    "| --- | --- | --- |",
    rows,
  ].join("\n");
}

function printLocal(diffs) {
  if (diffs.length === 0) {
    console.log("✅ Visual regression: 0 diffs detected");
    return;
  }
  console.log(`⚠️ Visual regression: ${diffs.length} diff(s) found:`);
  for (const d of diffs) {
    console.log(`  - ${d.relPath}`);
  }
}

async function ghApi(args, options = {}) {
  return execFile("gh", ["api", ...args], { encoding: "utf8", ...options });
}

async function findExistingComment(repo, prNumber) {
  // Paginate via --paginate so we don't miss the bot's comment on long threads.
  const { stdout } = await ghApi([
    "--paginate",
    `repos/${repo}/issues/${prNumber}/comments`,
  ]);
  // `--paginate` concatenates pages as one or more JSON arrays; normalize.
  const parsed = stdout
    .trim()
    .split(/\n(?=\[)/)
    .flatMap((chunk) => {
      try {
        return JSON.parse(chunk);
      } catch {
        return [];
      }
    });
  return parsed.find((c) => typeof c?.body === "string" && c.body.includes(MARKER));
}

async function postOrUpdateComment(repo, prNumber, body) {
  const existing = await findExistingComment(repo, prNumber).catch((err) => {
    console.warn(`visual-bot: could not list existing comments: ${err.message ?? err}`);
    return null;
  });
  if (existing?.id) {
    await ghApi([
      "--method",
      "PATCH",
      `repos/${repo}/issues/comments/${existing.id}`,
      "-f",
      `body=${body}`,
    ]);
    console.log(`visual-bot: updated comment ${existing.id}`);
    return;
  }
  await ghApi([
    "--method",
    "POST",
    `repos/${repo}/issues/${prNumber}/comments`,
    "-f",
    `body=${body}`,
  ]);
  console.log("visual-bot: posted new comment");
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const prNumber = process.env.GITHUB_PR_NUMBER;
  const repo = process.env.GITHUB_REPOSITORY;

  const diffs = await findDiffs();

  const ciMode = Boolean(token) && Boolean(prNumber) && Boolean(repo);
  if (!ciMode) {
    printLocal(diffs);
    return 0;
  }

  const body = buildCommentBody(diffs);
  try {
    await postOrUpdateComment(repo, prNumber, body);
  } catch (err) {
    console.warn(
      `visual-bot: comment API failed (non-fatal): ${err.stderr ?? err.message ?? err}`
    );
  }
  // Always print summary too, useful in CI logs.
  printLocal(diffs);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.warn(`visual-bot: unexpected error (non-fatal): ${err?.stack ?? err}`);
    process.exit(0);
  });
