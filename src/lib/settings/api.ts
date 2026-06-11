import { load, type Store } from "@tauri-apps/plugin-store";
import type { AiSettings } from "@/lib/ai/types";

export interface RecentRepo {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface AppSettings {
  ai: AiSettings;
  /** Provider/model for AI PR review (independent of the commit model). */
  reviewAi: AiSettings;
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
  globalInstructions: "",
  aiIgnorePatterns: "",
  externalEditor: "",
  externalEditorName: "",
  terminal: "",
  terminalPath: "",
  defaultBranch: "main",
  recentRepos: [],
  diffViewMode: "unified",
};

const MAX_RECENT_REPOS = 15;

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  storePromise ??= load("settings.json", { autoSave: true, defaults: {} });
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
  const recentRepos = [
    { ...repo, lastOpenedAt: new Date().toISOString() },
    ...settings.recentRepos.filter((r) => !samePath(r.path, repo.path)),
  ].slice(0, MAX_RECENT_REPOS);
  await saveSettings({ ...settings, recentRepos });
}

export async function removeRecentRepo(path: string): Promise<void> {
  const settings = await loadSettings();
  await saveSettings({
    ...settings,
    recentRepos: settings.recentRepos.filter((r) => r.path !== path),
  });
}
