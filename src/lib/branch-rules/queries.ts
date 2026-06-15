import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mergeBranchRules } from "./match";
import {
  loadBranchRules,
  loadSharedBranchRules,
  saveBranchRules,
  saveSharedBranchRules,
} from "./store";
import { type BranchRulesConfig, EMPTY_BRANCH_RULES } from "./types";

const branchRulesKey = (repo: string) => ["branch-rules", repo] as const;
const sharedBranchRulesKey = (repo: string) =>
  ["branch-rules-shared", repo] as const;

// ── Personal scope ──────────────────────────────────────────────────────────

export function useBranchRules(repo: string) {
  return useQuery({
    queryKey: branchRulesKey(repo),
    queryFn: () => loadBranchRules(repo),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSaveBranchRules(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: BranchRulesConfig) => saveBranchRules(repo, config),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: branchRulesKey(repo) }),
  });
}

// ── Shared scope (committed `.gitdesktop/branch-rules.json`) ─────────────────

export function useSharedBranchRules(repo: string) {
  return useQuery({
    queryKey: sharedBranchRulesKey(repo),
    queryFn: () => loadSharedBranchRules(repo),
    // The file can change out from under us (pull, branch switch), so let it
    // refetch on focus rather than caching forever.
    staleTime: 30_000,
  });
}

export function useSaveSharedBranchRules(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: BranchRulesConfig) =>
      saveSharedBranchRules(repo, config),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: sharedBranchRulesKey(repo) }),
  });
}

// ── Effective (merged) rules used by every enforcement point ─────────────────

/** Shared (repo) rules merged with personal rules — what actually enforces. */
export function useEffectiveBranchRules(repo: string): BranchRulesConfig {
  const personal = useBranchRules(repo);
  const shared = useSharedBranchRules(repo);
  return mergeBranchRules(
    shared.data ?? EMPTY_BRANCH_RULES,
    personal.data ?? EMPTY_BRANCH_RULES,
  );
}
