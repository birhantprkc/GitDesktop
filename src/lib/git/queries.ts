import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export const repoKeys = {
  all: (repo: string) => ["repo", repo] as const,
  status: (repo: string) => ["repo", repo, "status"] as const,
  branches: (repo: string) => ["repo", repo, "branches"] as const,
  diff: (repo: string, file: string, staged: boolean) =>
    ["repo", repo, "diff", file, staged] as const,
  commits: (repo: string) => ["repo", repo, "commits"] as const,
  log: (repo: string) => ["repo", repo, "log"] as const,
  commitDetails: (repo: string, hash: string) =>
    ["repo", repo, "commit", hash] as const,
  commitFiles: (repo: string, hash: string) =>
    ["repo", repo, "commit", hash, "files"] as const,
  commitFileDiff: (repo: string, hash: string, file: string) =>
    ["repo", repo, "commit", hash, "diff", file] as const,
  compare: (repo: string, base: string, compare: string) =>
    ["repo", repo, "compare", base, compare] as const,
  branchDiffFiles: (repo: string, base: string, compare: string) =>
    ["repo", repo, "compare", base, compare, "files"] as const,
  branchFileDiff: (repo: string, base: string, compare: string, file: string) =>
    ["repo", repo, "compare", base, compare, "diff", file] as const,
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

/** Owners (from each repo's origin remote) for grouping the repo list. */
export function useRepoOwners(paths: string[]) {
  const sorted = [...paths].sort();
  return useQuery({
    queryKey: ["repo-owners", sorted] as const,
    queryFn: () => api.gitRepoOwners(sorted),
    enabled: sorted.length > 0,
    staleTime: 10 * 60 * 1000,
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

const HISTORY_PAGE_SIZE = 200;

export function useLog(repo: string) {
  return useQuery({
    queryKey: repoKeys.log(repo),
    queryFn: () => api.gitLog(repo, HISTORY_PAGE_SIZE, 0),
  });
}

export function useCommitDetails(repo: string, hash: string | null) {
  return useQuery({
    queryKey: repoKeys.commitDetails(repo, hash ?? ""),
    queryFn: () => api.gitCommitDetails(repo, hash ?? ""),
    enabled: hash !== null,
    staleTime: Number.POSITIVE_INFINITY, // commits are immutable
  });
}

export function useCommitFiles(repo: string, hash: string | null) {
  return useQuery({
    queryKey: repoKeys.commitFiles(repo, hash ?? ""),
    queryFn: () => api.gitCommitFiles(repo, hash ?? ""),
    enabled: hash !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCommitFileDiff(
  repo: string,
  hash: string | null,
  file: string | null,
) {
  return useQuery({
    queryKey: repoKeys.commitFileDiff(repo, hash ?? "", file ?? ""),
    queryFn: () => api.gitCommitFileDiff(repo, hash ?? "", file ?? ""),
    enabled: hash !== null && file !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCompareBranches(
  repo: string,
  base: string | null,
  compare: string | null,
) {
  return useQuery({
    queryKey: repoKeys.compare(repo, base ?? "", compare ?? ""),
    queryFn: () => api.gitCompareBranches(repo, base ?? "", compare ?? ""),
    enabled: base !== null && compare !== null && base !== compare,
  });
}

export function useBranchDiffFiles(
  repo: string,
  base: string | null,
  compare: string | null,
) {
  return useQuery({
    queryKey: repoKeys.branchDiffFiles(repo, base ?? "", compare ?? ""),
    queryFn: () => api.gitBranchDiffFiles(repo, base ?? "", compare ?? ""),
    enabled: base !== null && compare !== null && base !== compare,
  });
}

export function useBranchFileDiff(
  repo: string,
  base: string | null,
  compare: string | null,
  file: string | null,
) {
  return useQuery({
    queryKey: repoKeys.branchFileDiff(
      repo,
      base ?? "",
      compare ?? "",
      file ?? "",
    ),
    queryFn: () =>
      api.gitBranchFileDiff(repo, base ?? "", compare ?? "", file ?? ""),
    enabled:
      base !== null && compare !== null && base !== compare && file !== null,
  });
}

export function useRemotes(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "remotes"] as const,
    queryFn: () => api.gitRemotes(repo),
  });
}

export function usePublishRepo(repo: string) {
  return useRepoMutation(
    repo,
    (args: { name: string; isPrivate: boolean; description: string }) =>
      api.ghPublishRepo(repo, args.name, args.isPrivate, args.description),
  );
}

export function usePrsForBranch(
  repo: string,
  head: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "prs", head ?? ""] as const,
    queryFn: () => api.ghPrsForBranch(repo, head ?? ""),
    enabled: enabled && head !== null,
    staleTime: 30_000,
  });
}

export function usePrList(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "pr-list"] as const,
    queryFn: () => api.ghPrList(repo),
    enabled,
    staleTime: 30_000,
  });
}

export function usePrDetails(repo: string, number: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "pr", number ?? 0] as const,
    queryFn: () => api.ghPrView(repo, number ?? 0),
    enabled: number !== null,
  });
}

export function usePrDiff(repo: string, number: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "pr", number ?? 0, "diff"] as const,
    queryFn: () => api.ghPrDiff(repo, number ?? 0),
    enabled: number !== null,
  });
}

export function useGhStatus(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "gh-status"] as const,
    queryFn: () => api.ghStatus(repo),
    staleTime: 60_000,
    retry: false,
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
  return useRepoMutation(
    repo,
    (args: { title: string; body?: string; amend?: boolean }) =>
      api.gitCommit(repo, args.title, args.body, args.amend ?? false),
  );
}

export function useCheckoutBranch(repo: string) {
  return useRepoMutation(repo, (name: string) =>
    api.gitCheckoutBranch(repo, name),
  );
}

export function useCreateBranch(repo: string) {
  return useRepoMutation(
    repo,
    (args: { name: string; checkout: boolean; startPoint?: string }) =>
      api.gitCreateBranch(repo, args.name, args.checkout, args.startPoint),
  );
}

export function useDiscard(repo: string) {
  return useRepoMutation(repo, (args: { path: string; untracked: boolean }) =>
    api.gitDiscard(repo, args.path, args.untracked),
  );
}

export function useAppendToGitignore(repo: string) {
  return useRepoMutation(repo, (pattern: string) =>
    api.appendToGitignore(repo, pattern),
  );
}

export function useResetToCommit(repo: string) {
  return useRepoMutation(repo, (hash: string) => api.gitReset(repo, hash));
}

export function useCheckoutCommit(repo: string) {
  return useRepoMutation(repo, (hash: string) =>
    api.gitCheckoutCommit(repo, hash),
  );
}

export function useRevertCommit(repo: string) {
  return useRepoMutation(repo, (hash: string) => api.gitRevert(repo, hash));
}

export function useCherryPick(repo: string) {
  return useRepoMutation(repo, (hash: string) => api.gitCherryPick(repo, hash));
}

export function useCherryPickOnto(repo: string) {
  return useRepoMutation(
    repo,
    (args: { hashes: string[]; targetBranch: string }) =>
      api.gitCherryPickOnto(repo, args.hashes, args.targetBranch),
  );
}

export function useCreateTag(repo: string) {
  return useRepoMutation(repo, (args: { name: string; hash: string }) =>
    api.gitTag(repo, args.name, args.hash),
  );
}

export function useFetchRemote(repo: string) {
  return useRepoMutation(repo, () => api.gitFetch(repo));
}

export function usePull(repo: string) {
  return useRepoMutation(repo, () => api.gitPull(repo));
}

export function usePush(repo: string) {
  return useRepoMutation(
    repo,
    (args: { setUpstream: boolean; force?: boolean }) =>
      api.gitPush(repo, args.setUpstream, args.force ?? false),
  );
}

export function useUndoCommit(repo: string) {
  return useRepoMutation(repo, () => api.gitUndoCommit(repo));
}

export function useDefaultBranch(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "default-branch"] as const,
    queryFn: () => api.gitDefaultBranch(repo),
  });
}

export function useStashCount(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "stash-count"] as const,
    queryFn: () => api.gitStashCount(repo),
  });
}

export function useRenameBranch(repo: string) {
  return useRepoMutation(repo, (args: { oldName: string; newName: string }) =>
    api.gitRenameBranch(repo, args.oldName, args.newName),
  );
}

export function useDeleteBranch(repo: string) {
  return useRepoMutation(repo, (name: string) =>
    api.gitDeleteBranch(repo, name),
  );
}

export function useDiscardAll(repo: string) {
  return useRepoMutation(repo, () => api.gitDiscardAll(repo));
}

export function useStashAll(repo: string) {
  return useRepoMutation(repo, () => api.gitStashAll(repo));
}

export function useStashPop(repo: string) {
  return useRepoMutation(repo, () => api.gitStashPop(repo));
}

export function useMergeBranch(repo: string) {
  return useRepoMutation(repo, (args: { branch: string; squash: boolean }) =>
    api.gitMerge(repo, args.branch, args.squash),
  );
}

export function useRebaseBranch(repo: string) {
  return useRepoMutation(repo, (branch: string) => api.gitRebase(repo, branch));
}

export function useMergeLocalPr(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      base: string;
      head: string;
      message: string;
      strategy: api.MergeStrategy;
    }) =>
      api.gitMergeLocalPr(
        repo,
        args.base,
        args.head,
        args.message,
        args.strategy,
      ),
  );
}

export function useReviewPr(repo: string) {
  return useRepoMutation(
    repo,
    (args: { number: number; action: api.ReviewAction; body: string }) =>
      api.ghPrReview(repo, args.number, args.action, args.body),
  );
}

export function useCommentPr(repo: string) {
  return useRepoMutation(repo, (args: { number: number; body: string }) =>
    api.ghPrComment(repo, args.number, args.body),
  );
}

export function useMergePr(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      number: number;
      strategy: api.MergeStrategy;
      deleteBranch: boolean;
    }) => api.ghPrMerge(repo, args.number, args.strategy, args.deleteBranch),
  );
}

export function useClosePr(repo: string) {
  return useRepoMutation(repo, (number: number) => api.ghPrClose(repo, number));
}

export function useReadyPr(repo: string) {
  return useRepoMutation(repo, (number: number) => api.ghPrReady(repo, number));
}

export function useCreatePr(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      base: string;
      head: string;
      title: string;
      body: string;
      draft: boolean;
    }) =>
      api.ghPrCreate(
        repo,
        args.base,
        args.head,
        args.title,
        args.body,
        args.draft,
      ),
  );
}
