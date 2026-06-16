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
process.stdout.write(`${section || `See the CHANGELOG for ${tag}.`}\n`);
