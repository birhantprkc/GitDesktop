import { load, type Store } from "@tauri-apps/plugin-store";
import {
  ALL_MERGE_METHODS,
  type BranchProtection,
  type BranchRulesConfig,
  EMPTY_BRANCH_RULES,
  type NamingPolicy,
} from "./types";

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
  const saved = await store.get<{
    naming?: Partial<NamingPolicy>;
    protections?: Partial<BranchProtection>[];
  }>(repo);
  // Tolerate configs written before a field existed: fill in per-protection
  // defaults so older saves don't suddenly restrict (or fail to restrict).
  return {
    naming: { ...EMPTY_BRANCH_RULES.naming, ...saved?.naming },
    protections: (saved?.protections ?? []).map((p) => ({
      id: p.id ?? crypto.randomUUID(),
      pattern: p.pattern ?? "",
      blockDeletion: p.blockDeletion ?? false,
      blockForcePush: p.blockForcePush ?? false,
      requirePr: p.requirePr ?? false,
      allowedMergeMethods: p.allowedMergeMethods ?? [...ALL_MERGE_METHODS],
    })),
  };
}

export async function saveBranchRules(
  repo: string,
  config: BranchRulesConfig,
): Promise<void> {
  const store = await getStore();
  await store.set(repo, config);
}
