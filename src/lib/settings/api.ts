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
  /** The origin remote's host (e.g. "gitlab.com"), stored alongside `owner` so
   *  the context menu names the right provider from the first frame. */
  host?: string;
  /** The provider that host routes to ("github" / "gitlab" / "bitbucket") —
   *  resolved backend-side (it knows glab's self-managed hosts) and stored so
   *  labels are right from the first frame. Absent until first resolved. */
  provider?: string;
  /** The persisted result of the visibility probe ("public" | "private" |
   *  "internal"). Absent = never resolved (the repo list shows no badge, which
   *  must never read as "public"). Cleared when the provider is cleared, so a
   *  stale badge never outlives the remote it was probed from. */
  visibility?: string;
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

/** One ordered environment variable / request header entry in an MCP server
 *  definition. Secret-bearing entries keep their `value` empty here (the real
 *  value lives in the OS keychain — see `McpServer.secretKeys`). */
export interface McpKeyValue {
  key: string;
  value: string;
}

/**
 * A managed MCP (Model Context Protocol) server the user has registered. Agent
 * sessions can opt into a subset of these; GitDesktop passes *exactly* the
 * opted-in servers to the CLI in strict / only-these mode, so a run never
 * silently inherits whatever MCP servers happen to be on the machine.
 *
 * The CLIs are the MCP *hosts* — GitDesktop only generates their config. Secret
 * values (tokens in env/headers) are stored in the OS keychain keyed by
 * `mcp-server/<id>/<entry-key>` and never written to settings.json; `secretKeys`
 * lists which env (stdio) / header (http) names are secret so they're resolved
 * from the keychain at session-launch time.
 */
export interface McpServer {
  /** Stable id (uuid) — list key, per-session opt-in reference, keychain namespace. */
  id: string;
  /** Display name; also the server key in the generated config. Letters, digits,
   *  `-`, `_` (no spaces); unique across the registry. */
  name: string;
  /** Optional human description shown in the list and the composer picker. */
  description: string;
  /** Offered to new sessions by default when true. */
  enabled: boolean;
  /** Where this server is available: "global" (or absent) = every repo; otherwise
   *  a repo root path = only sessions in that repo. Organization only — un-scoped
   *  servers are still never auto-inherited (strict mode gags un-registered ones). */
  scope?: string;
  /** Per-repo overrides of a GLOBAL server's state, keyed by repo root path:
   *  "on" (available + on by default), "optional" (available, off by default),
   *  "off" (not offered in that repo). Absent for a repo = inherit `enabled`.
   *  Only meaningful for global servers; repo-scoped ones use `enabled` directly. */
  repoOverrides?: Record<string, "on" | "optional" | "off">;
  /** "stdio" = a local subprocess; "http" = a remote streamable-HTTP server. */
  transport: "stdio" | "http";
  /** Executable to launch (stdio only), e.g. `npx`. */
  command: string;
  /** Arguments passed to `command` (stdio only). */
  args: string[];
  /** Non-secret environment variables (stdio only). */
  env: McpKeyValue[];
  /** Server URL (http only). */
  url: string;
  /** Non-secret request headers (http only). */
  headers: McpKeyValue[];
  /** env (stdio) / header (http) names whose values live in the OS keychain. */
  secretKeys: string[];
}

/** Background-fetch cadence, in minutes (stored as a string so it binds to the
 *  settings Select directly). */
export type AutoFetchInterval = "5" | "10" | "15" | "30" | "60";

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
  /** Extra network hosts (`host` or `host:port`) the app may reach for AI
   *  inference, beyond the built-in provider hosts and localhost — e.g. a LAN
   *  Ollama or a self-hosted OpenAI-compatible server. The shared AI `fetch`
   *  wrapper blocks any other host; the Tauri HTTP capability is opened to
   *  `http(s)://*` as a coarse backstop, so this list is the effective gate. */
  aiAllowedHosts: string[];
  /** Path to a program used by "Open in editor" (empty = not configured). */
  externalEditor: string;
  /** Friendly name for the configured editor, used in menu labels. */
  externalEditorName: string;
  /** Terminal kind id for "Open in terminal" (empty = default). */
  terminal: string;
  /** Executable path for the chosen terminal (empty for default/built-ins). */
  terminalPath: string;
  /** @deprecated No longer read. The default branch for new repos now lives in
   *  global git config (`init.defaultBranch`), edited in Settings → Git. Kept so
   *  existing settings.json files round-trip without churn. */
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
  /** Periodically run a background `git fetch` for the open repo so the
   *  behind-count and incoming commits stay current. Fetch only — never pulls,
   *  merges, or touches the working tree. */
  autoFetch: boolean;
  /** How often the background fetch runs, in minutes. */
  autoFetchInterval: AutoFetchInterval;
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
  /** Managed MCP servers an agent session can opt into. Empty = MCP stays off. */
  mcpServers: McpServer[];
  recentRepos: RecentRepo[];
  diffViewMode: "unified" | "split";
  /** Which conversation-list sections the user has collapsed, keyed
   *  `"<feature>:<kind>"` — `pulls:local`, `pulls:remote`, `issues:local`,
   *  `issues:remote`. A missing key means the section is expanded (the default).
   *  Global (not per-repo) and feature-scoped, so the remote key collapses the
   *  provider section across every repo regardless of its host. */
  collapsedConversationSections: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    ollamaBaseUrl: "http://localhost:11434",
    openaiCompatibleBaseUrl: "https://ai-gateway.vercel.sh/v1",
  },
  reviewAi: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    ollamaBaseUrl: "http://localhost:11434",
    openaiCompatibleBaseUrl: "https://ai-gateway.vercel.sh/v1",
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
  aiAllowedHosts: [],
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
  autoFetch: true,
  autoFetchInterval: "10",
  seenGuideNudge: false,
  analyticsEnabled: true,
  recordReplay: false,
  seenAnalyticsNotice: false,
  lastSeenVersion: "",
  syntaxMap: {},
  customLanguages: [],
  customCommands: [],
  mcpServers: [],
  recentRepos: [],
  diffViewMode: "unified",
  collapsedConversationSections: [],
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

/**
 * Serializes every `recentRepos` read-modify-write (load → modify → save)
 * through one module-level promise chain, so concurrent mutators can't clobber
 * each other. Each of the wrapped helpers below is a NON-atomic
 * loadSettings→modify→saveSettings; run two at once and they interleave —
 * A loads, B loads, A saves, B saves B's stale snapshot → A's write is lost.
 * That lost-update race is real: the visibility backfill fires up to three
 * concurrent persists while `persistRepoOwners` and `addRecentRepo` write the
 * same store, and it silently dropped persisted visibility for several repos.
 *
 * The no-op-when-unchanged guards inside each helper MUST stay inside this
 * critical section (they re-read fresh state under the lock) — do not hoist
 * them out or "simplify" this chain away.
 */
let recentRepoWrites: Promise<unknown> = Promise.resolve();
function serializedRecentRepoWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = recentRepoWrites.then(fn, fn);
  recentRepoWrites = run.catch(() => undefined);
  return run;
}

export function addRecentRepo(repo: {
  path: string;
  name: string;
}): Promise<void> {
  return serializedRecentRepoWrite(async () => {
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
  });
}

/**
 * Stores resolved repo owners (+ hosts) onto the matching recent-repo records
 * so the repo list groups synchronously (no async-driven reflow on open) and
 * the context menu names the right provider from the first frame. Touches only
 * records whose stored values actually changed; an empty remote clears them.
 * No-op when nothing changed, so it never loops with its own settings refetch.
 */
export function persistRepoOwners(
  owners: {
    path: string;
    owner: string | null;
    host: string | null;
    provider: string | null;
  }[],
): Promise<void> {
  if (owners.length === 0) return Promise.resolve();
  return serializedRecentRepoWrite(async () => {
    const settings = await loadSettings();
    const byPath = new Map(owners.map((o) => [o.path, o]));
    let changed = false;
    const recentRepos = settings.recentRepos.map((r) => {
      const resolved = byPath.get(r.path);
      if (!resolved) return r;
      const owner = resolved.owner || undefined;
      const host = resolved.host || undefined;
      const provider = resolved.provider || undefined;
      // Visibility is probed from the provider; when the provider is being
      // cleared (remote removed), the stored visibility can't outlive it — drop
      // it too so a stale badge never lingers on a now-local-only repo.
      const visibility = provider ? r.visibility : undefined;
      if (
        owner === r.owner &&
        host === r.host &&
        provider === r.provider &&
        visibility === r.visibility
      )
        return r;
      changed = true;
      return { ...r, owner, host, provider, visibility };
    });
    if (!changed) return;
    await saveSettings({ ...settings, recentRepos });
  });
}

/**
 * Stores resolved repo visibility ("public" | "private" | "internal") onto the
 * matching recent-repo records so the repo list shows the right visibility
 * badge synchronously next open. A null `visibility` clears the field (the
 * repo has no resolvable remote anymore). Touches only records whose stored
 * value actually changed; no-op when nothing changed, so it never loops with
 * its own settings refetch (mirrors {@link persistRepoOwners}).
 */
export function persistRepoVisibility(
  entries: { path: string; visibility: string | null }[],
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  return serializedRecentRepoWrite(async () => {
    const settings = await loadSettings();
    const byPath = new Map(entries.map((e) => [e.path, e]));
    let changed = false;
    const recentRepos = settings.recentRepos.map((r) => {
      const resolved = byPath.get(r.path);
      if (!resolved) return r;
      const visibility = resolved.visibility || undefined;
      if (visibility === r.visibility) return r;
      changed = true;
      return { ...r, visibility };
    });
    if (!changed) return;
    await saveSettings({ ...settings, recentRepos });
  });
}

/** Sets (or clears, with an empty string) the display alias for a repo. */
export function setRepoAlias(path: string, alias: string): Promise<void> {
  return serializedRecentRepoWrite(async () => {
    const settings = await loadSettings();
    const trimmed = alias.trim();
    await saveSettings({
      ...settings,
      recentRepos: settings.recentRepos.map((r) =>
        r.path === path ? { ...r, alias: trimmed || undefined } : r,
      ),
    });
  });
}

export function removeRecentRepo(path: string): Promise<void> {
  return serializedRecentRepoWrite(async () => {
    const settings = await loadSettings();
    await saveSettings({
      ...settings,
      recentRepos: settings.recentRepos.filter((r) => r.path !== path),
    });
  });
}
