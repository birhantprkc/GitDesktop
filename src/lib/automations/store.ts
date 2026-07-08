import { load, type Store } from "@tauri-apps/plugin-store";
import { repoIdentity } from "@/lib/git/repo-identity";
import { storeName } from "@/lib/test-mode";
import {
  type AutomationsConfig,
  EMPTY_AUTOMATIONS,
  type RepoAutomations,
  repoEntry,
} from "./types";

// Personal app-data — automation rules are the user's, never the repo's.
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(storeName("automations.json"), {
    autoSave: true,
    defaults: {},
  });
  return storePromise;
}

export async function loadAutomations(): Promise<AutomationsConfig> {
  const store = await getStore();
  const saved = await store.get<Partial<AutomationsConfig>>("config");
  return {
    global: saved?.global ?? EMPTY_AUTOMATIONS.global,
    repos: saved?.repos ?? EMPTY_AUTOMATIONS.repos,
  };
}

export async function saveAutomations(
  config: AutomationsConfig,
): Promise<void> {
  const store = await getStore();
  await store.set("config", config);
}

/** A repo's per-repo overrides, keyed by its worktree-stable identity (with a
 *  legacy checkout-path fallback until the next save folds it). Resolve once and
 *  pass into `effectiveRules`. */
export async function repoAutomationsFor(
  config: AutomationsConfig,
  repoPath: string,
): Promise<RepoAutomations | undefined> {
  const id = await repoIdentity(repoPath);
  return repoEntry(config, id, repoPath);
}

/** Replaces one repo's overrides, dropping the entry when it's a no-op. Keys by
 *  the repo's worktree-stable identity and drops any legacy checkout-path entry
 *  (folding it), so the overrides are shared across the main checkout and every
 *  worktree. */
export async function saveRepoAutomations(
  repoPath: string,
  repo: RepoAutomations,
): Promise<void> {
  const config = await loadAutomations();
  const id = await repoIdentity(repoPath);
  const repos = { ...config.repos };
  // Fold: a differently-keyed legacy entry for the same repo is replaced by this
  // identity-keyed write.
  if (id !== repoPath) delete repos[repoPath];
  if (repo.disabledGlobalIds.length === 0 && repo.rules.length === 0) {
    delete repos[id];
  } else {
    repos[id] = repo;
  }
  await saveAutomations({ ...config, repos });
}
