import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadAutomations, saveAutomations, saveRepoAutomations } from "./store";
import type { AutomationsConfigV2, RepoOverride } from "./types";

const automationsKey = ["automations"] as const;

export function useAutomations() {
  return useQuery({
    queryKey: automationsKey,
    queryFn: loadAutomations,
  });
}

export function useSaveAutomations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: AutomationsConfigV2) => saveAutomations(config),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: automationsKey }),
  });
}

export function useSaveRepoAutomations(repoPath: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repo: RepoOverride) => saveRepoAutomations(repoPath, repo),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: automationsKey }),
  });
}
