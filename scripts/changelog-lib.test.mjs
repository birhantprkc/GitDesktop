// Negative controls for validateFragments' paired-interrupter check — the
// prose tripwire behind `pnpm changelog:check`. Its fail-open direction is a
// strip rule that swallows too much and lets an interrupter through, so every
// exempt span keeps a fixture that must PASS beside prose that must FAIL.
//
// Unlike the guard scanners next door, validateFragments reads a directory, so
// fixtures land in a throwaway mkdtemp dir — never in changelog.d/, where a
// stray fixture would ship as a real changelog bullet.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { validateFragments } from "./changelog-lib.mjs";

/** Validate a `{ filename: body }` set of fragments in a throwaway dir. */
function validate(fixtures) {
  const dir = mkdtempSync(join(tmpdir(), "gd-changelog-"));
  try {
    for (const [name, body] of Object.entries(fixtures)) {
      writeFileSync(join(dir, name), body, "utf8");
    }
    return validateFragments(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a paired interrupter in plain prose is reported", () => {
  const problems = validate({
    "fixed-interrupter.md":
      "- The dialog now waits — even mid-switch — until the state settles.\n",
  });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, "fixed-interrupter.md");
  assert.match(problems[0].problem, /interrupter/);
});

test("em-dashes inside quoted, bold and code spans are exempt across a wrap", () => {
  // The bold span only closes on the continuation line, so this fails unless
  // the bullet is joined before the spans are stripped.
  const problems = validate({
    "fixed-quoted.md": [
      '- The banner shows "Paused — resolve conflicts" and the label reads **Timed',
      "  out — partial output kept**, with `gl-sast-report.json — raw` under Details.",
      "",
    ].join("\n"),
  });
  assert.deepEqual(problems, []);
});

test("a single em-dash gloss is fine", () => {
  const problems = validate({
    "changed-gloss.md":
      "- Auto-fetch now runs while the window is focused — it never pulls or merges.\n",
  });
  assert.deepEqual(problems, []);
});

test("em-dashes are counted per bullet, not per fragment", () => {
  // Two single glosses in one file are two glosses, not an interrupter.
  const problems = validate({
    "fixed-two-bullets.md": [
      "- The reaction chips name the hold — a tooltip says what they're waiting on.",
      "- The comment box does too — the same tooltip, on **Comment** and **Clear**.",
      "",
    ].join("\n"),
  });
  assert.deepEqual(problems, []);
});

test("a fragment failing an earlier check is not also flagged as an interrupter", () => {
  const problems = validate({
    "fixed-bad-indent.md": [
      "- The dialog now waits — even mid-switch — until the state settles.",
      "not indented, so the assembler would concatenate it verbatim.",
      "",
    ].join("\n"),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].problem, /indented 2 spaces/);
  assert.doesNotMatch(problems[0].problem, /interrupter/);
});
