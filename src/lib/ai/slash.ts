import type { AgentCommand } from "@/lib/git/api";
import type { CustomCommand } from "@/lib/settings/api";

/**
 * An item in the agent composer's `/` menu. Two kinds:
 * - `command` — a prompt template. No agent CLI parses `/command` in headless
 *   (`-p`/`exec`) mode, so we expand its body client-side (`$ARGUMENTS` and
 *   `$1`..`$9` substituted with what the user typed) and send the result.
 * - `skill` — an Agent Skill (a multi-file `SKILL.md` dir with progressive
 *   disclosure). We DON'T inline its body — the CLI already loaded the real
 *   skill from disk, so we nudge it by name and let the model invoke it.
 *
 * Sources, merged by (kind, name) with custom > discovered > builtin:
 * - `builtin` — the starters below;
 * - `agent` — discovered from the SELECTED CLI's command/skill dirs (project +
 *   global), including the vendor-neutral `.agents/skills` canonical store;
 * - `custom` — user-defined, edited under Settings → Slash commands.
 */
export interface SlashCommand {
  name: string;
  description: string;
  /** Template body for commands; empty for skills (and actions). */
  prompt: string;
  kind: "command" | "skill";
  source: "builtin" | "agent" | "custom";
  /** Where a discovered command/skill lives. */
  scope?: "project" | "global";
  /** Hint shown after the name in the menu, e.g. `[file]`. */
  argumentHint?: string;
  /** Built-in actions run instead of sending a prompt. */
  action?: "clear";
}

/** Starter commands every session gets. Tuned for an agent working in a
 *  throwaway worktree (it can read the diff and the tree). `$ARGUMENTS` sits on
 *  a trailing line so each reads cleanly with or without arguments. */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: "review",
    kind: "command",
    source: "builtin",
    argumentHint: "[optional focus]",
    description: "Review the working changes for bugs and clarity",
    prompt:
      "Review the changes in this worktree for correctness, bugs, edge cases, and clarity. Call out anything risky and suggest concrete fixes.\n\n$ARGUMENTS",
  },
  {
    name: "test",
    kind: "command",
    source: "builtin",
    argumentHint: "[file or behavior]",
    description: "Write tests covering edge cases",
    prompt:
      "Write thorough tests, covering edge cases and failure modes, for the following. Match the project's existing test style and run them.\n\n$ARGUMENTS",
  },
  {
    name: "fix",
    kind: "command",
    source: "builtin",
    argumentHint: "[describe the issue]",
    description: "Diagnose and fix an issue",
    prompt:
      "Find and fix the following issue. Explain the root cause first, then make the change.\n\n$ARGUMENTS",
  },
  {
    name: "explain",
    kind: "command",
    source: "builtin",
    argumentHint: "[file or symbol]",
    description: "Explain how something works",
    prompt:
      "Explain how the following works, step by step, citing the relevant files and lines.\n\n$ARGUMENTS",
  },
  {
    name: "refactor",
    kind: "command",
    source: "builtin",
    argumentHint: "[file or symbol]",
    description: "Refactor without changing behavior",
    prompt:
      "Refactor the following for readability and maintainability without changing behavior. Keep the diff focused.\n\n$ARGUMENTS",
  },
  {
    name: "clear",
    kind: "command",
    source: "builtin",
    description: "Clear the message box",
    prompt: "",
    action: "clear",
  },
];

// A `/name` invocation: the name, then (after whitespace) the rest as args.
// Names are letters/digits then word chars or hyphens; `/etc/hosts …` won't
// match (no whitespace after the name), so genuine paths are sent literally.
const INVOCATION_RE = /^\/([a-zA-Z0-9][\w-]*)(?:\s+([\s\S]*))?$/;

/** Parses a `/name args…` invocation from the (trimmed) draft, or null. */
export function parseSlashInvocation(
  text: string,
): { name: string; args: string } | null {
  const m = INVOCATION_RE.exec(text);
  if (!m) return null;
  return { name: m[1], args: m[2] ?? "" };
}

/** Finds a command/skill by name, case-insensitively (first match wins). */
export function findCommand(
  commands: SlashCommand[],
  name: string,
): SlashCommand | undefined {
  const n = name.toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === n);
}

/**
 * Builds the final prompt sent to the agent for a picked command/skill.
 * - Skills: a by-name nudge (+ any args) — the CLI loads the real skill.
 * - Commands: the template, expanded (see `expandCommand`).
 */
export function buildPrompt(cmd: SlashCommand, args: string): string {
  if (cmd.kind === "skill") {
    const nudge = `Use the "${cmd.name}" skill.`;
    const trimmed = args.trim();
    return trimmed ? `${nudge}\n\n${trimmed}` : nudge;
  }
  return expandCommand(cmd, args);
}

/**
 * Expands a command template against the user's argument string. Substitutes
 * `$ARGUMENTS` (the full args) and `$1`..`$9` (whitespace-split tokens). If the
 * template has no placeholder, non-empty args are appended as a trailing
 * paragraph so a bare `/cmd extra text` still carries the extra instruction.
 */
export function expandCommand(cmd: SlashCommand, args: string): string {
  const trimmed = args.trim();
  // `\b` so `$1` matches only as a whole token — a literal `$10` (a price) or
  // `$12` stays intact instead of being read as `$1` + "0".
  const hasPlaceholder =
    /\$ARGUMENTS\b/.test(cmd.prompt) || /\$[1-9]\b/.test(cmd.prompt);
  let out = cmd.prompt;
  if (hasPlaceholder) {
    const tokens = trimmed ? trimmed.split(/\s+/) : [];
    out = out
      .replace(/\$ARGUMENTS\b/g, trimmed)
      .replace(/\$([1-9])\b/g, (_, d: string) => tokens[Number(d) - 1] ?? "");
  } else if (trimmed) {
    out = `${out}\n\n${trimmed}`;
  }
  return out.trim();
}

/** Merges built-ins + the agent's discovered commands/skills + the user's
 *  custom commands, deduped by (kind, name) with custom > discovered > builtin
 *  (so a user's own command and the canonical skill win their slot). */
export function mergeCommands(
  discovered: AgentCommand[],
  custom: CustomCommand[],
): SlashCommand[] {
  const byKey = new Map<string, SlashCommand>();
  const key = (kind: string, name: string) => `${kind}:${name.toLowerCase()}`;
  for (const c of BUILTIN_COMMANDS) byKey.set(key(c.kind, c.name), c);
  for (const c of discovered) {
    if (!c.name.trim()) continue;
    byKey.set(key(c.kind, c.name), {
      name: c.name,
      description: c.description,
      prompt: c.prompt,
      kind: c.kind,
      source: "agent",
      scope: c.scope,
      argumentHint: c.argumentHint || undefined,
    });
  }
  for (const c of custom) {
    const name = c.name.trim();
    if (!name) continue;
    byKey.set(key("command", name), {
      name,
      description: c.description,
      prompt: c.prompt,
      kind: "command",
      source: "custom",
    });
  }
  return [...byKey.values()];
}

/** Filters + ranks for the menu: name-prefix matches first, then substring
 *  matches, each group keeping its original order. */
export function filterCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return commands;
  const prefix: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const c of commands) {
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) prefix.push(c);
    else if (n.includes(q)) contains.push(c);
  }
  return [...prefix, ...contains];
}
