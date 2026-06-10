import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export const repoKeys = {
  all: (repo: string) => ["repo", repo] as const,
  status: (repo: string) => ["repo", repo, "status"] as const,
  branches: (repo: string) => ["repo", repo, "branches"] as const,
  diff: (repo: string, file: string, staged: boolean) =>
    ["repo", repo, "diff", file, staged] as const,
  commits: (repo: string) => ["repo", repo, "commits"] as const,
};

export function useGitInstalled() {
  return useQuery({
    queryKey: ["git-installed"],
    queryFn: api.checkGitInstalled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useRepoStatus(repo: string) {
  return useQuery({
    queryKey: repoKeys.status(repo),
    queryFn: () => api.gitStatus(repo),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
}

export function useBranches(repo: string) {
  return useQuery({
    queryKey: repoKeys.branches(repo),
    queryFn: () => api.gitBranches(repo),
  });
}

export function useFileDiff(
  repo: string,
  file: { path: string; staged: boolean; untracked: boolean } | null,
) {
  return useQuery({
    queryKey: repoKeys.diff(repo, file?.path ?? "", file?.staged ?? false),
    queryFn: () =>
      api.gitDiffFile(
        repo,
        file?.path ?? "",
        file?.staged ?? false,
        file?.untracked ?? false,
      ),
    enabled: file !== null,
  });
}

/** Builds a mutation that invalidates everything under the repo when done. */
function useRepoMutation<TArgs, TData>(
  repo: string,
  mutationFn: (args: TArgs) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: repoKeys.all(repo) }),
  });
}

export function useStage(repo: string) {
  return useRepoMutation(repo, (paths: string[]) => api.gitStage(repo, paths));
}

export function useUnstage(repo: string) {
  return useRepoMutation(repo, (paths: string[]) =>
    api.gitUnstage(repo, paths),
  );
}

export function useCommit(repo: string) {
  return useRepoMutation(repo, (args: { title: string; body?: string }) =>
    api.gitCommit(repo, args.title, args.body),
  );
}

export function useCheckoutBranch(repo: string) {
  return useRepoMutation(repo, (name: string) =>
    api.gitCheckoutBranch(repo, name),
  );
}

export function useCreateBranch(repo: string) {
  return useRepoMutation(repo, (args: { name: string; checkout: boolean }) =>
    api.gitCreateBranch(repo, args.name, args.checkout),
  );
}

export function useFetchRemote(repo: string) {
  return useRepoMutation(repo, () => api.gitFetch(repo));
}

export function usePull(repo: string) {
  return useRepoMutation(repo, () => api.gitPull(repo));
}

export function usePush(repo: string) {
  return useRepoMutation(repo, (setUpstream: boolean) =>
    api.gitPush(repo, setUpstream),
  );
}
