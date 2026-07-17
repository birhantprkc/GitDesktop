#!/usr/bin/env node
// Prints a Keep-a-Changelog draft from the Conventional Commits since the last
// tag (or all history if there are no tags). This is a STARTING POINT — curate
// the output into clear, user-facing prose before pasting it under
// "## [Unreleased]" in CHANGELOG.md. Run with: pnpm changelog
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countEntries,
  readFragments,
  renderSectionLines,
  validateFragments,
} from "./changelog-lib.mjs";

// `--check` mode: validate every pending fragment (filename + bullet format)
// without assembling anything, reporting ALL problems at once. Emits GitHub
// Actions ::error annotations so the changelog workflow fails red on the exact
// file BEFORE merge, instead of the release driver tripping over it later.
// Run locally with: pnpm changelog:check
if (process.argv.includes("--check")) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "changelog.d");
  const problems = validateFragments(dir);
  if (problems.length > 0) {
    for (const p of problems) {
      process.stderr.write(`::error file=changelog.d/${p.file}::${p.problem}\n`);
    }
    process.stderr.write(
      `\n${problems.length} invalid changelog fragment(s) — see changelog.d/README.md for the format.\n`,
    );
    process.exit(1);
  }
  const { files } = readFragments(dir);
  process.stdout.write(`${files.length} pending fragment(s), all valid.\n`);
  process.exit(0);
}

// `--preview` mode: show the pending changelog.d/ fragments assembled under an
// Unreleased heading, without touching any file. (Plain `pnpm changelog`, below,
// still drafts a starting point from the Conventional Commits since the last tag.)
if (process.argv.includes("--preview")) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "changelog.d");
  const { groups } = readFragments(dir);
  if (countEntries(groups) === 0) {
    process.stdout.write(
      "No pending changelog.d fragments. Add one as changelog.d/<added|changed|fixed>-<slug>.md.\n",
    );
    process.exit(0);
  }
  process.stdout.write(
    `${renderSectionLines("## [Unreleased] — pending fragments", groups).join("\n").trimEnd()}\n`,
  );
  process.exit(0);
}

const git = (args) =>
  execSync(`git ${args}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

let range = "";
try {
  range = `${git("describe --tags --abbrev=0")}..HEAD`;
} catch {
  // No tags yet — fall back to the entire history.
}

const log = git(`log ${range} --pretty=format:%s`);
const subjects = log ? log.split("\n") : [];

// Conventional-commit type → Keep a Changelog group. Noise types are skipped.
const TYPE_GROUP = {
  feat: "Added",
  fix: "Fixed",
  perf: "Changed",
  refactor: "Changed",
  revert: "Changed",
};
const SKIP = new Set(["chore", "docs", "style", "test", "ci", "build"]);

const groups = { Added: [], Changed: [], Fixed: [] };
for (const subject of subjects) {
  const m = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (!m) continue;
  const [, type, scope, _bang, desc] = m;
  if (SKIP.has(type)) continue;
  const group = TYPE_GROUP[type];
  if (!group) continue;
  const body = scope ? `**${scope}:** ${desc}` : desc;
  groups[group].push(`- ${body.charAt(0).toUpperCase()}${body.slice(1)}`);
}

const out = ["## [Unreleased]", ""];
for (const [name, items] of Object.entries(groups)) {
  if (items.length === 0) continue;
  out.push(`### ${name}`, "", ...items, "");
}
const body = out.join("\n").trim();
process.stdout.write(
  `${body || "No user-facing commits since the last tag."}\n\n` +
    "// ^ Draft only — rewrite these into curated, user-facing notes before committing.\n",
);
