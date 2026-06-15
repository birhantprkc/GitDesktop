import { load, type Store } from "@tauri-apps/plugin-store";
import { readRepoBranchRules, writeRepoBranchRules } from "@/lib/git/api";
import {
  ALL_MERGE_METHODS,
  type BranchProtection,
  type BranchRulesConfig,
  EMPTY_BRANCH_RULES,
  type NamingPolicy,
} from "./types";

/**
 * Coerces a loosely-typed (possibly older or hand-edited) config into a full
 * BranchRulesConfig, filling in per-field defaults so partial data never
 * suddenly restricts — or fails to restrict. Shared by the personal store and
 * the repo-committed `.gitdesktop/branch-rules.json` file.
 */
export function normalizeBranchRules(saved: unknown): BranchRulesConfig {
  const obj = (saved ?? {}) as {
    naming?: Partial<NamingPolicy>;
    protections?: Partial<BranchProtection>[];
  };
  return {
    naming: { ...EMPTY_BRANCH_RULES.naming, ...obj.naming },
    protections: (obj.protections ?? []).map((p) => ({
      id: p.id ?? crypto.randomUUID(),
      pattern: p.pattern ?? "",
      blockDeletion: p.blockDeletion ?? false,
      blockForcePush: p.blockForcePush ?? false,
      requirePr: p.requirePr ?? false,
      allowedMergeMethods: p.allowedMergeMethods ?? [...ALL_MERGE_METHODS],
    })),
  };
}

// ── Personal scope: app-data keyed by repo path, never committed ────────────

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load("branch-rules.json", { autoSave: true, defaults: {} });
  return storePromise;
}

export async function loadBranchRules(
  repo: string,
): Promise<BranchRulesConfig> {
  const store = await getStore();
  return normalizeBranchRules(await store.get(repo));
}

export async function saveBranchRules(
  repo: string,
  config: BranchRulesConfig,
): Promise<void> {
  const store = await getStore();
  await store.set(repo, config);
}

// ── Shared scope: committed `<repo>/.gitdesktop/branch-rules.json` ───────────

export async function loadSharedBranchRules(
  repo: string,
): Promise<BranchRulesConfig> {
  const raw = await readRepoBranchRules(repo);
  if (!raw) return EMPTY_BRANCH_RULES;
  try {
    return normalizeBranchRules(JSON.parse(raw));
  } catch {
    // A malformed committed file shouldn't break the app — ignore it.
    return EMPTY_BRANCH_RULES;
  }
}

export async function saveSharedBranchRules(
  repo: string,
  config: BranchRulesConfig,
): Promise<void> {
  // Pretty-printed so the committed file stays diff-friendly.
  await writeRepoBranchRules(repo, `${JSON.stringify(config, null, 2)}\n`);
}
