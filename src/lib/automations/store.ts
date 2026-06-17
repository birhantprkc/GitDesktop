import { load, type Store } from "@tauri-apps/plugin-store";
import { storeName } from "@/lib/test-mode";
import {
  type AutomationsConfig,
  EMPTY_AUTOMATIONS,
  type RepoAutomations,
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

/** Replaces one repo's overrides, dropping the entry when it's a no-op. */
export async function saveRepoAutomations(
  repoPath: string,
  repo: RepoAutomations,
): Promise<void> {
  const config = await loadAutomations();
  const repos = { ...config.repos };
  if (repo.disabledGlobalIds.length === 0 && repo.rules.length === 0) {
    delete repos[repoPath];
  } else {
    repos[repoPath] = repo;
  }
  await saveAutomations({ ...config, repos });
}
