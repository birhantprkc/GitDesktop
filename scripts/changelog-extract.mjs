#!/usr/bin/env node
// Prints the CHANGELOG.md section for a given version/tag, for use as the GitHub
// Release body (which in turn feeds the auto-updater's release notes). Falls
// back to a pointer if the section can't be found. Usage:
//   node scripts/changelog-extract.mjs v0.2.0
import { readFileSync } from "node:fs";

const tag = process.argv[2] ?? "";
const version = tag.replace(/^v/, "");

let text;
try {
  text = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
} catch {
  process.stdout.write("See CHANGELOG.md for release notes.\n");
  process.exit(0);
}

const lines = text.split(/\r?\n/);
const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Matches "## [0.2.0]" with or without a trailing date.
const header = new RegExp(`^##\\s*\\[${esc}\\]`);

const start = lines.findIndex((l) => header.test(l));
if (start === -1) {
  process.stdout.write(`See the CHANGELOG for ${tag || "this release"}.\n`);
  process.exit(0);
}
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s*\[/.test(lines[i])) {
    end = i;
    break;
  }
}

const section = lines
  .slice(start + 1, end)
  .join("\n")
  .trim();

const notes = section || `See the CHANGELOG for ${tag}.`;

// GitHub rejects a release body over 125,000 characters, and Linux caps any
// single env var — tauri-action receives the body as INPUT_RELEASEBODY — at
// 128 KiB (MAX_ARG_STRLEN). A very large changelog blows past both and fails
// the whole release (Linux with "Argument list too long", the other legs with
// an API "body is too long" error). When the notes don't fit, keep the top and
// link out to the full file. Budget stays under both limits with margin.
const MAX_BYTES = 120_000;
const byteLen = (s) => Buffer.byteLength(s, "utf8");

if (byteLen(`${notes}\n`) <= MAX_BYTES) {
  process.stdout.write(`${notes}\n`);
} else {
  // GITHUB_REPOSITORY / GITHUB_SERVER_URL are always set in Actions; fall back
  // to a bare filename when run locally.
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const changelogUrl = repo
    ? `${server}/${repo}/blob/${tag}/CHANGELOG.md`
    : "CHANGELOG.md";
  const footer = `\n\n---\n\n_Release notes truncated — see the [full changelog](${changelogUrl}) for the rest._\n`;
  const budget = MAX_BYTES - byteLen(footer);

  // Keep whole lines only, so the truncated markdown still renders cleanly.
  let kept = "";
  let used = 0;
  for (const line of notes.split("\n")) {
    const chunk = `${line}\n`;
    const chunkBytes = byteLen(chunk);
    if (used + chunkBytes > budget) break;
    kept += chunk;
    used += chunkBytes;
  }
  process.stdout.write(`${kept.trimEnd()}${footer}`);
}
