import { load, type Store } from "@tauri-apps/plugin-store";
import { type BranchRulesConfig, EMPTY_BRANCH_RULES } from "./types";

// Personal app-data, keyed by repo path — branch rules are the user's local
// guardrails, never committed into the repository.
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load("branch-rules.json", { autoSave: true, defaults: {} });
  return storePromise;
}

export async function loadBranchRules(
  repo: string,
): Promise<BranchRulesConfig> {
  const store = await getStore();
  const saved = await store.get<Partial<BranchRulesConfig>>(repo);
  // Tolerate configs written before a field existed.
  return {
    naming: { ...EMPTY_BRANCH_RULES.naming, ...saved?.naming },
    protections: saved?.protections ?? [],
  };
}

export async function saveBranchRules(
  repo: string,
  config: BranchRulesConfig,
): Promise<void> {
  const store = await getStore();
  await store.set(repo, config);
}
