#!/usr/bin/env node
// Drift gate for the git-whitelist hard rule, which lives in five carriers by
// design — the canonical playbook, its always-loaded excerpt, the repo
// AGENTS.md that agents outside Claude auto-load, and the two agent definitions
// that restate it as their own charter. Two review findings in one round came
// from a rule changing in one carrier and not the others, so the class ships
// its guard: each carrier must still state the whitelist's core.
// The agent definitions are junction-mounted from the owner's private skills
// repo (personal workflow, not shipped with the project), so they gate as
// MOUNTED_CARRIERS: sentinel-checked whenever present — always true on the
// owner's machine, the only place their drift can be authored — and skipped
// with a note in clones and CI, which have no junction.
// A sixth statement — the codex spec preamble in
// .claude/skills/delegate/references/codex-implementer.md (junction-mounted
// likewise; not tracked here) — is deliberately condensed for a prompt and is
// NOT sentinel-matchable, so it stays out of the carrier lists and is kept in
// sync by hand; trimming it never trips this gate.
//
// PRESENCE, not equality: the copies word the rule differently on purpose (one
// is a numbered hard rule, one a bullet, one prose for a different audience),
// so verbatim comparison would fail on every legitimate edit. Each sentinel is
// the smallest phrase whose ABSENCE means a carrier lost the rule.
//
// Matching runs over whitespace-NORMALIZED text: every carrier hand-wraps at a
// different width, so a line break inside a sentinel phrase would otherwise
// read as a missing rule.
//
// Run: node scripts/check-rule-mirrors.mjs
// GD_RULE_MIRROR_ROOT points the check at a copy of the tree, for an ad-hoc
// negative control by hand: copy the carriers, mutate one, watch it go red.
// The committed controls live in scripts/checks.test.mjs and drive
// `missingSentinels` in memory, touching no disk.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Tracked files that state the git-whitelist rule — present in every clone. */
export const CARRIERS = [
  ".claude/skills/gd-conventions/SKILL.md",
  ".claude/rules/git-safety.md",
  "AGENTS.md",
];

/**
 * Junction-mounted carriers: same rule, same sentinels, but the files live in
 * the owner's private skills repo and only exist where the junction does.
 * Absent ⇒ skipped with a note (clones, CI); present ⇒ gated exactly like
 * CARRIERS.
 */
export const MOUNTED_CARRIERS = [
  ".claude/agents/implementer.md",
  ".claude/agents/spec-reviewer.md",
];

/**
 * Each sentinel names what its absence would mean, and carries the fix a
 * reader needs — never just "pattern not found".
 */
export const SENTINELS = [
  {
    name: "read-only git forms",
    pattern: /git --no-pager diff/,
    fix: "state the permitted read-only forms, starting `git --no-pager diff`",
  },
  {
    name: "branch --list allowance",
    pattern: /git branch --list/,
    fix: "keep `git branch --list` in the permitted set",
  },
  {
    name: "forbidden catchall",
    // The lookahead is the point: a carrier that keeps the sentence and then
    // carves an exception out of it ("is forbidden, except …") has lost the
    // rule as surely as one that deleted it. Its scope is narrow, though — it
    // sees an exception qualifier immediately following "is forbidden", so
    // differently-phrased carve-outs ("with one exception:", "— save for")
    // still pass.
    pattern:
      /(everything else|every other git invocation|every state-mutating git command)[\s\S]{0,300}?is forbidden(?!\s*(?:,|;|—|-)?\s*(?:except|but|unless)\b)/i,
    fix: "keep the catchall sentence forbidding every other git invocation, with no except/but/unless clause carved out of it",
  },
  {
    name: "-C worktree sanction",
    pattern: /-C <path>[^.]{0,40}task worktree/i,
    fix: "sanction the `-C <path>` form so worktree-scoped commands stay legal",
  },
];

export const normalize = (text) => text.replace(/\s+/g, " ");

/** Sentinels a carrier's text no longer satisfies. */
export function missingSentinels(text, sentinels = SENTINELS) {
  const flat = normalize(text);
  return sentinels.filter((s) => !s.pattern.test(flat));
}

function main() {
  const root = process.env.GD_RULE_MIRROR_ROOT
    ? resolve(process.env.GD_RULE_MIRROR_ROOT)
    : REPO_ROOT;

  let failed = false;
  const gate = (carrier) => {
    let text;
    try {
      text = readFileSync(join(root, carrier), "utf8");
    } catch (err) {
      failed = true;
      process.stderr.write(`rule-mirrors: FAIL — cannot read ${carrier}\n`);
      process.stderr.write(`    ${err.message}\n`);
      return;
    }
    const missing = missingSentinels(text);
    if (missing.length === 0) {
      process.stdout.write(
        `rule-mirrors: OK ${carrier} (${SENTINELS.length} sentinels)\n`,
      );
      return;
    }
    failed = true;
    process.stderr.write(
      `rule-mirrors: FAIL ${carrier} (${missing.length} of ${SENTINELS.length} sentinels missing)\n`,
    );
    for (const s of missing) {
      process.stderr.write(`  missing: ${s.name}\n`);
      process.stderr.write(`    ${s.fix}\n`);
    }
  };

  for (const carrier of CARRIERS) gate(carrier);
  for (const carrier of MOUNTED_CARRIERS) {
    if (!existsSync(join(root, carrier))) {
      process.stdout.write(`rule-mirrors: SKIP ${carrier} (not mounted)\n`);
      continue;
    }
    gate(carrier);
  }

  // Not `process.exit`: it can truncate a pending pipe write, losing the very
  // finding the failure is about on a CI runner.
  process.exitCode = failed ? 1 : 0;
}

// Main-module detection by PATH comparison, not `import.meta.main`: that form
// only exists from node 24.2 and fails SILENTLY on older runtimes (the gate
// reads `if (undefined)` and exits 0 having checked nothing).
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
