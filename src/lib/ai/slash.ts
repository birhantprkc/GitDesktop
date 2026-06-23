import type { RepoCommand } from "@/lib/git/api";
import type { CustomCommand } from "@/lib/settings/api";

/**
 * A slash command available in the agent composer's `/` menu. No agent CLI
 * parses `/command` in headless (`-p`/`exec`) mode, so commands are expanded
 * entirely on the client — `prompt` is a template whose `$ARGUMENTS` (and
 * `$1`..`$9`) placeholders are substituted with whatever the user types after
 * the command before it's sent to the agent.
 *
 * Commands come from three sources, merged by name (custom > repo > builtin):
 * - `builtin` — the handful of starters defined below;
 * - `repo` — the repo's own `.claude/commands/*.md` (Claude Code's format);
 * - `custom` — user-defined, edited under Settings → Slash commands.
 */
export interface SlashCommand {
  /** Name typed after `/` (no leading slash). */
  name: string;
  /** Short description shown in the menu. */
  description: string;
  /** Prompt template; `$ARGUMENTS`/`$1..` expanded on use. Empty for actions. */
  prompt: string;
  source: "builtin" | "repo" | "custom";
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
    source: "builtin",
    argumentHint: "[optional focus]",
    description: "Review the working changes for bugs and clarity",
    prompt:
      "Review the changes in this worktree for correctness, bugs, edge cases, and clarity. Call out anything risky and suggest concrete fixes.\n\n$ARGUMENTS",
  },
  {
    name: "test",
    source: "builtin",
    argumentHint: "[file or behavior]",
    description: "Write tests covering edge cases",
    prompt:
      "Write thorough tests, covering edge cases and failure modes, for the following. Match the project's existing test style and run them.\n\n$ARGUMENTS",
  },
  {
    name: "fix",
    source: "builtin",
    argumentHint: "[describe the issue]",
    description: "Diagnose and fix an issue",
    prompt:
      "Find and fix the following issue. Explain the root cause first, then make the change.\n\n$ARGUMENTS",
  },
  {
    name: "explain",
    source: "builtin",
    argumentHint: "[file or symbol]",
    description: "Explain how something works",
    prompt:
      "Explain how the following works, step by step, citing the relevant files and lines.\n\n$ARGUMENTS",
  },
  {
    name: "refactor",
    source: "builtin",
    argumentHint: "[file or symbol]",
    description: "Refactor without changing behavior",
    prompt:
      "Refactor the following for readability and maintainability without changing behavior. Keep the diff focused.\n\n$ARGUMENTS",
  },
  {
    name: "clear",
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

/** Finds a command by name, case-insensitively. */
export function findCommand(
  commands: SlashCommand[],
  name: string,
): SlashCommand | undefined {
  const n = name.toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === n);
}

/**
 * Expands a command's template against the user's argument string. Substitutes
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

/** Merges the three command sources into one list, deduped by name with
 *  custom > repo > builtin precedence (a user override wins). */
export function mergeCommands(
  repo: RepoCommand[],
  custom: CustomCommand[],
): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const c of BUILTIN_COMMANDS) byName.set(c.name.toLowerCase(), c);
  for (const c of repo) {
    if (!c.name.trim()) continue;
    byName.set(c.name.toLowerCase(), {
      name: c.name,
      description: c.description,
      prompt: c.prompt,
      source: "repo",
      argumentHint: c.argumentHint || undefined,
    });
  }
  for (const c of custom) {
    const name = c.name.trim();
    if (!name) continue;
    byName.set(name.toLowerCase(), {
      name,
      description: c.description,
      prompt: c.prompt,
      source: "custom",
    });
  }
  return [...byName.values()];
}

/** Filters + ranks commands for the menu: name-prefix matches first, then
 *  substring matches, each group keeping its original order. */
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
