import { load, type Store } from "@tauri-apps/plugin-store";
import type { AiSettings } from "@/lib/ai/types";
import { storeName } from "@/lib/test-mode";

export interface RecentRepo {
  path: string;
  name: string;
  lastOpenedAt: string;
  /** User-chosen display name shown in place of the folder name. */
  alias?: string;
  /** Owner (from the origin remote) the repo list groups under. Stored so the
   *  list can group synchronously and never reflows while the async owners
   *  query resolves; backfilled from `gitRepoOwners` and refreshed in the
   *  background. Absent until first resolved; empty remote clears it. */
  owner?: string;
}

/** What to call a repo in the UI: its alias when set, else its name. */
export function repoDisplayName(repo: RecentRepo): string {
  return repo.alias?.trim() || repo.name;
}

/**
 * A user-defined minimal grammar for diff syntax highlighting, referenced from
 * `syntaxMap` by its `id`. Built into a highlight.js language at runtime — see
 * features/diff/syntax.ts.
 */
export interface CustomLanguage {
  /** Stable id used as the highlighter language name and the syntaxMap target.
   *  Lowercase token (letters/digits/hyphen). */
  id: string;
  /** Display name shown in pickers. */
  name: string;
  /** Keywords, separated by spaces, commas, or newlines. */
  keywords: string;
  /** Line-comment prefix (e.g. "//" or "#"); empty = none. */
  lineComment: string;
  /** Block-comment delimiters (e.g. "/*" and "*\/"); both empty = none. */
  blockCommentStart: string;
  blockCommentEnd: string;
  /** String delimiter characters (e.g. "\"'`"); empty = none. */
  stringDelimiters: string;
  /** Match keywords case-insensitively. */
  caseInsensitive: boolean;
  /** A full VSCode TextMate grammar (parsed `.tmLanguage.json`). When present,
   *  the diff renders this language with Shiki for VSCode-fidelity highlighting
   *  and the minimal fields above are ignored. */
  tmGrammar?: Record<string, unknown>;
}

/**
 * A user-defined agent slash command, surfaced in the agent composer's `/`
 * menu alongside the built-ins and the repo's own `.claude/commands`. The
 * `prompt` is a template — `$ARGUMENTS` (and `$1`..`$9`) are substituted with
 * whatever the user types after the command, expanded client-side before the
 * prompt reaches the agent.
 */
export interface CustomCommand {
  /** Stable id (uuid) used for list keys. */
  id: string;
  /** Name typed after `/` — letters, digits, `-`, `_` (no spaces). */
  name: string;
  /** Short description shown in the slash menu. */
  description: string;
  /** Prompt template; `$ARGUMENTS`/`$1..` expanded on use. */
  prompt: string;
}

export interface NotificationSettings {
  /** Automation results (review posted / ready / failed). */
  automations: boolean;
  /** An AI code review or security audit you started finishing in the background. */
  reviews: boolean;
  /** CI check completion on open PRs. */
  prChecks: "off" | "mine" | "all";
  /** PRs opened / merged / closed in the current repo. */
  prActivity: boolean;
  /** Review decisions on PRs you authored. */
  prReviews: boolean;
  /** Workflow runs finishing (success/failure) on the current branch. */
  actionRuns: boolean;
}

export interface AppSettings {
  ai: AiSettings;
  /** Provider/model for AI PR review (independent of the commit model). */
  reviewAi: AiSettings;
  /** Hide every AI surface (commit/PR helpers, review panel, AI settings).
   *  Provider config and API keys are kept, just not shown. */
  hideAi: boolean;
  /** OS notifications (sent only while the window is unfocused). */
  notifications: NotificationSettings;
  /** Hide the app to the system tray on window close (so background work like
   *  AI reviews keeps running) instead of quitting. */
  closeToTray: boolean;
  /** How write-capable agent sessions are isolated. "worktree" = the throwaway
   *  git worktree only (host, full-auto); "container" = also run inside an
   *  ephemeral Docker/Podman container for kernel-enforced filesystem
   *  confinement (opt-in; needs Docker/Podman installed). */
  agentIsolation: "worktree" | "container";
  /** Node base-image major version for the agent container image (digits, e.g.
   *  "24"). */
  agentImageNodeVersion: string;
  /** Which container-capable agents to bake into the image. */
  agentImageProviders: ("claude" | "codex" | "opencode" | "copilot")[];
  globalInstructions: string;
  /** gitignore-style globs (one per line) excluded from AI context. */
  aiIgnorePatterns: string;
  /** Path to a program used by "Open in editor" (empty = not configured). */
  externalEditor: string;
  /** Friendly name for the configured editor, used in menu labels. */
  externalEditorName: string;
  /** Terminal kind id for "Open in terminal" (empty = default). */
  terminal: string;
  /** Executable path for the chosen terminal (empty for default/built-ins). */
  terminalPath: string;
  /** Branch name used by `git init` for newly created repositories. */
  defaultBranch: string;
  /** Hotkey overrides by action id; null = explicitly unbound. Actions not
   *  present use their registry default. */
  hotkeys: Record<string, string | null>;
  /** Warn before amending a commit that's already on the remote (force push).
   *  Cleared by the dialog's "Don't show this again". */
  confirmAmendForcePush: boolean;
  /** Show the Ctrl/Shift-click multi-select hint above the changes list.
   *  Cleared by the hint's "Don't show again". */
  showSelectionHint: boolean;
  /** Show the "drag to stage individual lines" hint in the working-tree diff. */
  showLineStageHint: boolean;
  /** Check GitHub Releases for a new version on launch (install stays opt-in). */
  autoCheckUpdates: boolean;
  /** First-run nudge toward the user guide; set once the user opens or dismisses it. */
  seenGuideNudge: boolean;
  /** Send anonymous usage events to PostHog. Default on (opt-out). */
  analyticsEnabled: boolean;
  /** Record masked session replays. Default off (opt-in, for GDPR/ePrivacy). */
  recordReplay: boolean;
  /** Set once the first-run analytics notice has been dismissed. */
  seenAnalyticsNotice: boolean;
  /** App version last shown to the user, to drive the "What's new" dialog. */
  lastSeenVersion: string;
  /** Diff syntax highlighting: file extension (no dot, lowercase) → a
   *  highlight.js language name or a CustomLanguage id. Overrides built-ins. */
  syntaxMap: Record<string, string>;
  /** User-defined grammars referenced by `syntaxMap`. */
  customLanguages: CustomLanguage[];
  /** User-defined agent slash commands for the agent composer's `/` menu. */
  customCommands: CustomCommand[];
  recentRepos: RecentRepo[];
  diffViewMode: "unified" | "split";
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    ollamaBaseUrl: "http://localhost:11434",
  },
  reviewAi: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    ollamaBaseUrl: "http://localhost:11434",
  },
  hideAi: false,
  notifications: {
    automations: true,
    reviews: true,
    prChecks: "all",
    prActivity: true,
    prReviews: true,
    actionRuns: true,
  },
  closeToTray: true,
  agentIsolation: "worktree",
  agentImageNodeVersion: "24",
  agentImageProviders: ["claude", "codex"],
  globalInstructions: "",
  aiIgnorePatterns: "",
  externalEditor: "",
  externalEditorName: "",
  terminal: "",
  terminalPath: "",
  defaultBranch: "main",
  hotkeys: {},
  confirmAmendForcePush: true,
  showSelectionHint: true,
  showLineStageHint: true,
  autoCheckUpdates: true,
  seenGuideNudge: false,
  analyticsEnabled: true,
  recordReplay: false,
  seenAnalyticsNotice: false,
  lastSeenVersion: "",
  syntaxMap: {},
  customLanguages: [],
  customCommands: [],
  recentRepos: [],
  diffViewMode: "unified",
};

const MAX_RECENT_REPOS = 200;

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  storePromise ??= load(storeName("settings.json"), {
    autoSave: true,
    defaults: {},
  });
  return storePromise;
}

export async function loadSettings(): Promise<AppSettings> {
  const store = await getStore();
  const saved = await store.get<Partial<AppSettings>>("settings");
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    ai: { ...DEFAULT_SETTINGS.ai, ...saved?.ai },
    reviewAi: { ...DEFAULT_SETTINGS.reviewAi, ...saved?.reviewAi },
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...saved?.notifications,
    },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const store = await getStore();
  await store.set("settings", settings);
}

export async function addRecentRepo(repo: {
  path: string;
  name: string;
}): Promise<void> {
  const settings = await loadSettings();
  // Windows paths are case-insensitive; compare them that way to dedupe
  const samePath = (a: string, b: string) =>
    a.toLowerCase() === b.toLowerCase();
  // Reopening a repo must not wipe the alias on its previous entry.
  const previous = settings.recentRepos.find((r) =>
    samePath(r.path, repo.path),
  );
  const recentRepos = [
    {
      ...repo,
      alias: previous?.alias,
      lastOpenedAt: new Date().toISOString(),
    },
    ...settings.recentRepos.filter((r) => !samePath(r.path, repo.path)),
  ].slice(0, MAX_RECENT_REPOS);
  await saveSettings({ ...settings, recentRepos });
}

/**
 * Stores resolved repo owners onto the matching recent-repo records so the
 * repo list groups synchronously (no async-driven reflow on open). Touches
 * only records whose stored owner actually changed; an empty remote clears it.
 * No-op when nothing changed, so it never loops with its own settings refetch.
 */
export async function persistRepoOwners(
  owners: { path: string; owner: string | null }[],
): Promise<void> {
  if (owners.length === 0) return;
  const settings = await loadSettings();
  const ownerOf = new Map(owners.map((o) => [o.path, o.owner || undefined]));
  let changed = false;
  const recentRepos = settings.recentRepos.map((r) => {
    if (!ownerOf.has(r.path)) return r;
    const owner = ownerOf.get(r.path);
    if (owner === r.owner) return r;
    changed = true;
    return { ...r, owner };
  });
  if (!changed) return;
  await saveSettings({ ...settings, recentRepos });
}

/** Sets (or clears, with an empty string) the display alias for a repo. */
export async function setRepoAlias(path: string, alias: string): Promise<void> {
  const settings = await loadSettings();
  const trimmed = alias.trim();
  await saveSettings({
    ...settings,
    recentRepos: settings.recentRepos.map((r) =>
      r.path === path ? { ...r, alias: trimmed || undefined } : r,
    ),
  });
}

export async function removeRecentRepo(path: string): Promise<void> {
  const settings = await loadSettings();
  await saveSettings({
    ...settings,
    recentRepos: settings.recentRepos.filter((r) => r.path !== path),
  });
}
