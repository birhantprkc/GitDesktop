#!/usr/bin/env node
// Cut a release: assemble the changelog.d/*.md fragments into CHANGELOG.md as a
// new "## [X.Y.Z] - <today>" section, bump package.json + src-tauri/Cargo.toml in
// sync, and delete the consumed fragments. Usage:
//   pnpm release:prepare 0.2.0            (or: node scripts/changelog-release.mjs 0.2.0)
//   pnpm release:prepare 0.2.0 --no-merge (append fragments below the pending body
//                                          instead of merging into its categories)
//
// The pending "## [Unreleased]" body is preserved: fragments are merged into its
// matching category blocks (existing bytes untouched), then it's promoted to the
// version heading with a fresh empty "## [Unreleased]" left above. The emitted
// heading matches changelog-extract.mjs, so the release workflow keeps working.
// The script never commits or tags — review the diff, then commit + tag yourself:
//   git commit -am "chore(release): v0.2.0" && git tag v0.2.0 && git push origin master v0.2.0
// (push the tag explicitly — release tags are lightweight; --follow-tags skips them), or just run: pnpm release

import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_ORDER,
  countEntries,
  readFragments,
  readLF,
  renderGroupBlocks,
  renderSectionLines,
  writeLF,
} from "./changelog-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const fail = (msg) => {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
};

const noMerge = process.argv.includes("--no-merge");
const version = process.argv.slice(2).find((a) => /^\d+\.\d+\.\d+$/.test(a));
if (!version) {
  process.stderr.write(
    "usage: node scripts/changelog-release.mjs <major.minor.patch> [--no-merge]\n" +
      "  (pass the bare version, e.g. 0.2.0 — no leading 'v')\n",
  );
  process.exit(1);
}
const date = new Date().toISOString().slice(0, 10);

// --- 1. Collect fragments ---------------------------------------------------
const fragmentDir = join(root, "changelog.d");
const { files, groups } = readFragments(fragmentDir);
const total = countEntries(groups);

// --- 2. Locate the [Unreleased] region in CHANGELOG.md ----------------------
const changelogPath = join(root, "CHANGELOG.md");
const lines = readLF(changelogPath).split("\n");

const unreleasedIdx = lines.findIndex((l) => /^##\s*\[Unreleased\]/i.test(l));
if (unreleasedIdx === -1)
  fail("could not find '## [Unreleased]' in CHANGELOG.md");
let nextIdx = lines.length;
for (let i = unreleasedIdx + 1; i < lines.length; i++) {
  if (/^##\s*\[/.test(lines[i])) {
    nextIdx = i;
    break;
  }
}
// The body between "## [Unreleased]" and the next "## [" heading. It normally
// opens and closes with a blank line, which we preserve.
const body = lines.slice(unreleasedIdx + 1, nextIdx);
const hasHeadings = body.some((l) => /^###\s+/.test(l));

// --- 3. Build the promoted version body -------------------------------------
const versionHeading = `## [${version}] - ${date}`;
let newBody;
if (hasHeadings && !noMerge) {
  newBody = mergeIntoBody(body, groups);
} else {
  newBody = appendToBody(body, groups);
}
const newRegion = ["## [Unreleased]", "", versionHeading, ...newBody];

// --- 4. Reassemble, then rewrite the compare-link definitions ---------------
let text = [
  ...lines.slice(0, unreleasedIdx),
  ...newRegion,
  ...lines.slice(nextIdx),
].join("\n");
text = rewriteCompareLinks(text, version);
writeLF(changelogPath, text);

// --- 5. Bump versions in sync (targeted regex — never JSON/TOML round-trip) --
bumpVersion(
  join(root, "package.json"),
  /("version":\s*")\d+\.\d+\.\d+(")/,
  version,
);
bumpVersion(
  join(root, "src-tauri", "Cargo.toml"),
  /(^\[package\][\s\S]*?\nversion = ")\d+\.\d+\.\d+(")/m,
  version,
);

// --- 6. Delete consumed fragments -------------------------------------------
for (const f of files) rmSync(f);

// --- 7. Summary -------------------------------------------------------------
const perCat = CATEGORY_ORDER.filter((c) => groups[c].length)
  .map((c) => `${groups[c].length} ${c}`)
  .join(", ");
process.stdout.write(
  `Prepared ${version} (${date}).\n` +
    `  changelog.d fragments consumed: ${total}${perCat ? ` (${perCat})` : ""}\n` +
    "  bumped: package.json, src-tauri/Cargo.toml (tauri.conf.json reads ../package.json)\n" +
    "\nReview the diff, then:\n" +
    `  git commit -am "chore(release): v${version}" && git tag v${version} && git push origin master v${version}\n`,
);

// --- helpers ----------------------------------------------------------------

// Insert each category's new bullets at the end of that category's FIRST block
// in the pending body, leaving every existing line untouched. Creates a missing
// category heading in canonical Added→Changed→Fixed order.
function mergeIntoBody(bodyLines, grp) {
  const out = [...bodyLines];
  for (const cat of CATEGORY_ORDER) {
    if (!grp[cat].length) continue;
    const bullets = grp[cat].flatMap((b) => b.split("\n"));
    const headingIdx = out.findIndex((l) =>
      new RegExp(`^###\\s+${cat}\\b`).test(l),
    );
    if (headingIdx !== -1) {
      let end = out.length;
      for (let i = headingIdx + 1; i < out.length; i++) {
        if (/^###\s+/.test(out[i]) || /^##\s+/.test(out[i])) {
          end = i;
          break;
        }
      }
      let at = end;
      while (at > headingIdx + 1 && out[at - 1].trim() === "") at--;
      out.splice(at, 0, ...bullets);
    } else {
      const later = CATEGORY_ORDER.slice(CATEGORY_ORDER.indexOf(cat) + 1);
      let beforeIdx = -1;
      for (const lc of later) {
        const idx = out.findIndex((l) =>
          new RegExp(`^###\\s+${lc}\\b`).test(l),
        );
        if (idx !== -1) {
          beforeIdx = idx;
          break;
        }
      }
      if (beforeIdx !== -1) {
        out.splice(beforeIdx, 0, `### ${cat}`, "", ...bullets, "");
      } else {
        let at = out.length;
        while (at > 0 && out[at - 1].trim() === "") at--;
        out.splice(at, 0, "", `### ${cat}`, "", ...bullets);
      }
    }
  }
  return out;
}

// Empty pending body (steady state) or --no-merge: keep any existing content
// verbatim, then append freshly rendered category blocks.
function appendToBody(bodyLines, grp) {
  const blocks = renderGroupBlocks(grp);
  // Strip surrounding blank lines to find real content.
  let start = 0;
  let end = bodyLines.length;
  while (start < end && bodyLines[start].trim() === "") start++;
  while (end > start && bodyLines[end - 1].trim() === "") end--;
  const content = bodyLines.slice(start, end);
  if (content.length === 0) return blocks.length ? ["", ...blocks] : ["", ""];
  return ["", ...content, "", ...blocks];
}

// Repoint [Unreleased] to compare against the new tag and insert the new
// version's compare link. `vPREV` is derived from the existing [Unreleased] def
// (the authoritative "last released" marker).
function rewriteCompareLinks(fullText, ver) {
  const m = fullText.match(
    /^\[Unreleased\]:\s*(\S+?)\/compare\/v([\d.]+)\.\.\.HEAD\s*$/m,
  );
  if (!m)
    fail(
      "could not find the '[Unreleased]: …/compare/vPREV...HEAD' link definition",
    );
  const [, base, prev] = m;
  const replacement =
    `[Unreleased]: ${base}/compare/v${ver}...HEAD\n` +
    `[${ver}]: ${base}/compare/v${prev}...v${ver}`;
  return fullText.replace(m[0], replacement);
}

function bumpVersion(path, re, ver) {
  const src = readLF(path);
  const next = src.replace(re, `$1${ver}$2`);
  if (next === src) fail(`could not bump the version in ${path}`);
  writeLF(path, next);
}
