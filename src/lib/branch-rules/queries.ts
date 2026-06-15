import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadBranchRules, saveBranchRules } from "./store";
import type { BranchRulesConfig } from "./types";

const branchRulesKey = (repo: string) => ["branch-rules", repo] as const;

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
