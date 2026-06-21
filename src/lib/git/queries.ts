import {
  keepPreviousData,
  type QueryKey,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { COLD_START_NO_GH, COLD_START_NO_GIT } from "@/lib/test-mode";
import * as api from "./api";
import type {
  DiffStatEntry,
  DiscussionDetails,
  GhStatus,
  IssueDetails,
  IssueReactions,
  IssueRelation,
  IssueType,
  Reaction,
  RepoOp,
  RepoSettingsInput,
  RewriteStep,
  UnignoreRule,
  WebhookInput,
} from "./types";

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

/**
 * The working-tree query keys a staging-class mutation actually touches: repo
 * status, every working-tree file diff, and the worktree side of file-at-rev
 * reads (the image-diff "new" pane) — all prefix-matched. Hot mutations
 * (stage/unstage/discard/apply) pass this to {@link useRepoMutation} so they
 * don't needlessly mark the heavy history/branches/Insights/SBOM queries stale.
 * The committed-rev file-at-rev reads are deliberately left alone (their content
 * can't change), so only the `"worktree"` slice is invalidated.
 */
const workingTreeKeys = (repo: string) =>
  [
    repoKeys.status(repo),
    ["repo", repo, "diff"],
    ["repo", repo, "file-b64", "worktree"],
  ] as const;

export function useGitInstalled() {
  return useQuery({
    queryKey: ["git-installed"],
    // Cold-start test mode can pretend git is absent to exercise GitMissingScreen.
    queryFn: COLD_START_NO_GIT
      ? () => Promise.reject(new Error("Git not found (cold-start test mode)"))
      : api.checkGitInstalled,
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

export const HISTORY_PAGE_SIZE = 200;

/** Paged commit log; `data.pages.flat()` is the loaded history. */
export function useLog(repo: string) {
  return useInfiniteQuery({
    queryKey: repoKeys.log(repo),
    queryFn: ({ pageParam }) => api.gitLog(repo, HISTORY_PAGE_SIZE, pageParam),
    initialPageParam: 0,
    // The next page skips everything loaded so far; a short page means
    // history is exhausted.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < HISTORY_PAGE_SIZE
        ? undefined
        : allPages.reduce((n, p) => n + p.length, 0),
  });
}

/** Whole-history search by commit message, paged. Idle until `query` is set. */
export function useCommitSearch(repo: string, query: string) {
  const q = query.trim();
  return useInfiniteQuery({
    queryKey: ["repo", repo, "log-search", q] as const,
    queryFn: ({ pageParam }) =>
      api.gitLog(repo, HISTORY_PAGE_SIZE, pageParam, q),
    enabled: q.length > 0,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < HISTORY_PAGE_SIZE
        ? undefined
        : allPages.reduce((n, p) => n + p.length, 0),
  });
}

// Shared query definitions so the hook and the prefetch path can't drift.
// Commits are immutable, so once fetched their data never goes stale.
const commitDetailsOptions = (repo: string, hash: string) =>
  queryOptions({
    queryKey: repoKeys.commitDetails(repo, hash),
    queryFn: () => api.gitCommitDetails(repo, hash),
    staleTime: Number.POSITIVE_INFINITY,
  });

const commitFilesOptions = (repo: string, hash: string) =>
  queryOptions({
    queryKey: repoKeys.commitFiles(repo, hash),
    queryFn: () => api.gitCommitFiles(repo, hash),
    staleTime: Number.POSITIVE_INFINITY,
  });

const commitFileDiffOptions = (repo: string, hash: string, file: string) =>
  queryOptions({
    queryKey: repoKeys.commitFileDiff(repo, hash, file),
    queryFn: () => api.gitCommitFileDiff(repo, hash, file),
    staleTime: Number.POSITIVE_INFINITY,
  });

export function useCommitDetails(repo: string, hash: string | null) {
  return useQuery({
    ...commitDetailsOptions(repo, hash ?? ""),
    enabled: hash !== null,
    // Keep the prior commit's content on screen while the next loads, so
    // arrowing through history doesn't flash a skeleton on every step.
    placeholderData: keepPreviousData,
  });
}

export function useCommitFiles(repo: string, hash: string | null) {
  return useQuery({
    ...commitFilesOptions(repo, hash ?? ""),
    enabled: hash !== null,
    placeholderData: keepPreviousData,
  });
}

export function useCommitFileDiff(
  repo: string,
  hash: string | null,
  file: string | null,
) {
  return useQuery({
    ...commitFileDiffOptions(repo, hash ?? "", file ?? ""),
    enabled: hash !== null && file !== null,
    placeholderData: keepPreviousData,
  });
}

/**
 * Warms a commit's detail view (header + file list + the first file's diff) so
 * selecting it is instant. Called on row hover and for the rows adjacent to the
 * current selection (so keyboard arrowing stays ahead). prefetchQuery is a
 * no-op once the data is cached, so repeats are free.
 */
export function usePrefetchCommit(repo: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (hash: string) => {
      queryClient.prefetchQuery(commitDetailsOptions(repo, hash));
      await queryClient.prefetchQuery(commitFilesOptions(repo, hash));
      const files = queryClient.getQueryData<DiffStatEntry[]>(
        repoKeys.commitFiles(repo, hash),
      );
      const first = files?.[0]?.path;
      if (first) {
        queryClient.prefetchQuery(commitFileDiffOptions(repo, hash, first));
      }
    },
    [queryClient, repo],
  );
}

/** Warms a single file's diff within a commit (row hover / adjacent file). */
export function usePrefetchCommitFileDiff(repo: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (hash: string, file: string) =>
      queryClient.prefetchQuery(commitFileDiffOptions(repo, hash, file)),
    [queryClient, repo],
  );
}

/**
 * Debounces hover-triggered prefetches so sweeping the pointer down a long list
 * doesn't spawn a prefetch (and its git subprocesses) for every row it crosses
 * — only the row the pointer settles on fires. Keyboard-neighbor prefetch stays
 * immediate. Returns a trigger you hand the prefetch thunk to.
 */
export function useHoverPrefetch(delay = 100) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (run: () => void) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(run, delay);
    },
    [delay],
  );
}

/** Commit history for a single file (follows renames), paged. */
export function useFileLog(repo: string, path: string | null) {
  return useInfiniteQuery({
    queryKey: ["repo", repo, "file-log", path ?? ""] as const,
    queryFn: ({ pageParam }) =>
      api.gitFileLog(repo, path ?? "", HISTORY_PAGE_SIZE, pageParam),
    enabled: path !== null && path !== "",
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < HISTORY_PAGE_SIZE
        ? undefined
        : allPages.reduce((n, p) => n + p.length, 0),
  });
}

/** `git blame` for a file at HEAD. */
export function useBlame(repo: string, path: string | null) {
  return useQuery({
    queryKey: ["repo", repo, "blame", path ?? ""] as const,
    queryFn: () => api.gitBlame(repo, path ?? ""),
    enabled: path !== null && path !== "",
    staleTime: 60_000,
  });
}

export function useCommitAuthors(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "commit-authors"] as const,
    queryFn: () => api.gitCommitAuthors(repo),
    staleTime: 60_000,
  });
}

export function useGlobalIdentity() {
  return useQuery({
    queryKey: ["global-identity"] as const,
    queryFn: api.gitGlobalIdentity,
  });
}

export function useSetGlobalIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; email: string }) =>
      api.gitSetGlobalIdentity(args.name, args.email),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["global-identity"] }),
  });
}

export function useUserIdentity(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "user-identity"] as const,
    queryFn: () => api.gitUserIdentity(repo),
    staleTime: 5 * 60_000,
  });
}

/** Repo-wide stats; the scan is heavy, so only fetch while the dialog is up. */
export function useRepoStats(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "stats"] as const,
    queryFn: () => api.gitRepoStats(repo),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useBranchStats(
  repo: string,
  branch: string | null,
  base: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "branch-stats", branch ?? "", base ?? ""] as const,
    queryFn: () => api.gitBranchStats(repo, branch ?? "", base ?? ""),
    enabled: enabled && branch !== null && base !== null && branch !== base,
    staleTime: 60_000,
  });
}

// ── Insights graphs ──────────────────────────────────────────────────────────
// All keyed on the trailing window (`weeks`) so toggling it refetches. Local-git
// queries are cheap to keep fresh; the gh community call is gated on a GitHub repo.

export function useContributorActivity(
  repo: string,
  weeks: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "insights", "contributors", weeks] as const,
    queryFn: () => api.gitContributorActivity(repo, weeks),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCommitActivity(
  repo: string,
  weeks: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "insights", "commit-activity", weeks] as const,
    queryFn: () => api.gitCommitActivity(repo, weeks),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCodeFrequency(
  repo: string,
  weeks: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "insights", "code-frequency", weeks] as const,
    queryFn: () => api.gitCodeFrequency(repo, weeks),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function usePunchCard(repo: string, weeks: number, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "insights", "punch-card", weeks] as const,
    queryFn: () => api.gitPunchCard(repo, weeks),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCommunityInsights(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "insights", "community"] as const,
    queryFn: () => api.ghCommunityInsights(repo),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRepoTraffic(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "insights", "traffic"] as const,
    queryFn: () => api.ghRepoTraffic(repo),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRepoDependencies(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "insights", "dependencies"] as const,
    queryFn: () => api.ghRepoDependencies(repo),
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
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
    placeholderData: keepPreviousData,
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
    placeholderData: keepPreviousData,
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
    (args: {
      name: string;
      isPrivate: boolean;
      description: string;
      homepage: string;
      topics: string[];
    }) =>
      api.ghPublishRepo(
        repo,
        args.name,
        args.isPrivate,
        args.description,
        args.homepage,
        args.topics,
      ),
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

export function usePrList(
  repo: string,
  enabled: boolean,
  state: api.PrStateFilter,
) {
  return useQuery({
    queryKey: ["repo", repo, "pr-list", state] as const,
    queryFn: () => api.ghPrList(repo, state),
    enabled,
    staleTime: 30_000,
  });
}

export function useRepoLabels(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "labels"] as const,
    queryFn: () => api.ghRepoLabels(repo),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// Shared definitions so the hook and the prefetch path stay in sync. A short
// stale window makes a hover-prefetched PR open with no extra round-trip; the
// window-focus refetch still keeps an open PR current.
const prDetailsOptions = (repo: string, number: number) =>
  queryOptions({
    queryKey: ["repo", repo, "pr", number] as const,
    queryFn: () => api.ghPrView(repo, number),
    staleTime: 30_000,
  });

const prDiffOptions = (repo: string, number: number) =>
  queryOptions({
    queryKey: ["repo", repo, "pr", number, "diff"] as const,
    queryFn: () => api.ghPrDiff(repo, number),
    staleTime: 30_000,
  });

export function usePrDetails(repo: string, number: number | null) {
  return useQuery({
    ...prDetailsOptions(repo, number ?? 0),
    enabled: number !== null,
    placeholderData: keepPreviousData,
  });
}

export function usePrDiff(repo: string, number: number | null) {
  return useQuery({
    ...prDiffOptions(repo, number ?? 0),
    enabled: number !== null,
    placeholderData: keepPreviousData,
  });
}

/**
 * Warms a remote PR's view (metadata + diff) so opening it is instant. PR data
 * comes over the network (the slowest loads in the app), so prefetching on row
 * hover and for the adjacent rows pays off most here.
 */
export function usePrefetchPr(repo: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (number: number) => {
      queryClient.prefetchQuery(prDetailsOptions(repo, number));
      queryClient.prefetchQuery(prDiffOptions(repo, number));
    },
    [queryClient, repo],
  );
}

/** Reactions for a PR's body + comments — decoupled from the PR view so it
 *  loads in parallel and leaves the (untouched) PR query alone. */
export function usePrReactions(repo: string, number: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "pr", number ?? 0, "reactions"] as const,
    queryFn: () => api.ghPrReactions(repo, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  });
}

export function useIssueList(
  repo: string,
  enabled: boolean,
  state: api.IssueStateFilter,
) {
  return useQuery({
    queryKey: ["repo", repo, "issue-list", state] as const,
    queryFn: () => api.ghIssueList(repo, state),
    enabled,
    staleTime: 30_000,
  });
}

const issueDetailsOptions = (repo: string, number: number) =>
  queryOptions({
    queryKey: ["repo", repo, "issue", number] as const,
    queryFn: () => api.ghIssueView(repo, number),
    staleTime: 30_000,
  });

export function useIssueDetails(repo: string, number: number | null) {
  return useQuery({
    ...issueDetailsOptions(repo, number ?? 0),
    enabled: number !== null,
    placeholderData: keepPreviousData,
  });
}

/** Warms an issue's view so opening it from the list is instant (hover/adjacent
 *  rows), mirroring {@link usePrefetchPr}. */
export function usePrefetchIssue(repo: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (number: number) => {
      queryClient.prefetchQuery(issueDetailsOptions(repo, number));
    },
    [queryClient, repo],
  );
}

export function useCreateIssue(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      title: string;
      body: string;
      labels: string[];
      assignees: string[];
      milestone: number | null;
      type: string | null;
    }) =>
      api.ghIssueCreate(
        repo,
        args.title,
        args.body,
        args.labels,
        args.assignees,
        args.milestone,
        args.type,
      ),
  );
}

export function useAssignableUsers(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "assignable-users"] as const,
    queryFn: () => api.ghAssignableUsers(repo),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useMilestones(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "milestones"] as const,
    queryFn: () => api.ghMilestones(repo),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * An issue meta mutation (assignee/milestone/type) with an optimistic patch of
 * the issue-details cache + rollback, so the sidebar updates instantly instead
 * of waiting on the PATCH + refetch. `patch` applies the new value locally; the
 * extra display fields callers pass (milestone title, the full type) are only
 * for this patch — the backend takes just the id/name.
 */
function useOptimisticIssueMutation<TArgs extends { number: number }, TData>(
  repo: string,
  mutationFn: (args: TArgs) => Promise<TData>,
  patch: (issue: IssueDetails, args: TArgs) => IssueDetails,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (args: TArgs) => {
      const key = ["repo", repo, "issue", args.number] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<IssueDetails>(key);
      queryClient.setQueryData<IssueDetails>(key, (d) =>
        d ? patch(d, args) : d,
      );
      return { prev, key };
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_d, _e, args) =>
      queryClient.invalidateQueries({
        queryKey: ["repo", repo, "issue", args.number],
      }),
  });
}

export function useSetIssueAssignees(repo: string) {
  return useOptimisticIssueMutation(
    repo,
    (args: { number: number; assignees: string[] }) =>
      api.ghIssueSetAssignees(repo, args.number, args.assignees),
    (issue, args) => ({ ...issue, assignees: args.assignees }),
  );
}

export function useSetIssueMilestone(repo: string) {
  return useOptimisticIssueMutation(
    repo,
    (args: {
      number: number;
      milestone: number | null;
      /** Title for the optimistic chip (backend takes only the number). */
      title?: string | null;
    }) => api.ghIssueSetMilestone(repo, args.number, args.milestone),
    (issue, args) => ({
      ...issue,
      milestone:
        args.milestone === null
          ? null
          : { number: args.milestone, title: args.title ?? "" },
    }),
  );
}

export function useIssueTypes(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "issue-types"] as const,
    queryFn: () => api.ghIssueTypes(repo),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSetIssueType(repo: string) {
  return useOptimisticIssueMutation(
    repo,
    (args: {
      number: number;
      typeName: string | null;
      /** The full type for the optimistic patch (backend takes only the name). */
      type?: IssueType | null;
    }) => api.ghIssueSetType(repo, args.number, args.typeName),
    (issue, args) => ({ ...issue, issueType: args.type ?? null }),
  );
}

export function usePinIssue(repo: string) {
  return useRepoMutation(repo, (args: { number: number; pinned: boolean }) =>
    args.pinned
      ? api.ghIssuePin(repo, args.number)
      : api.ghIssueUnpin(repo, args.number),
  );
}

export function useLockIssue(repo: string) {
  return useRepoMutation(
    repo,
    (args: { number: number; reason: api.LockReason | null }) =>
      api.ghIssueLock(repo, args.number, args.reason),
  );
}

export function useUnlockIssue(repo: string) {
  return useRepoMutation(repo, (number: number) =>
    api.ghIssueUnlock(repo, number),
  );
}

export function useIssueReactions(repo: string, number: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "issue", number ?? 0, "reactions"] as const,
    queryFn: () => api.ghIssueReactions(repo, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  });
}

function patchReactionList(
  list: Reaction[],
  content: string,
  active: boolean,
): Reaction[] {
  const existing = list.find((r) => r.content === content);
  if (active) {
    // Removing the viewer's reaction.
    if (!existing) return list;
    const count = existing.count - 1;
    return count <= 0
      ? list.filter((r) => r.content !== content)
      : list.map((r) =>
          r.content === content ? { ...r, count, viewerReacted: false } : r,
        );
  }
  // Adding the viewer's reaction.
  if (existing) {
    return list.map((r) =>
      r.content === content
        ? { ...r, count: r.count + 1, viewerReacted: true }
        : r,
    );
  }
  return [...list, { content, count: 1, viewerReacted: true }];
}

/**
 * Toggles the viewer's reaction with an optimistic cache update + rollback, so
 * the chip responds instantly instead of waiting on a refetch. `reactionsKey`
 * is the issue/discussion reactions query; `bodyId` is the issue/discussion
 * node id (anything else is a comment id). Works for issues and discussions.
 */
export function useToggleReaction(
  repo: string,
  reactionsKey: QueryKey,
  bodyId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      subjectId: string;
      content: string;
      active: boolean;
    }) =>
      args.active
        ? api.ghRemoveReaction(repo, args.subjectId, args.content)
        : api.ghAddReaction(repo, args.subjectId, args.content),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: reactionsKey });
      const prev = queryClient.getQueryData<IssueReactions>(reactionsKey);
      queryClient.setQueryData<IssueReactions>(reactionsKey, (data) => {
        const base: IssueReactions = data ?? { body: [], comments: {} };
        if (args.subjectId === bodyId) {
          return {
            ...base,
            body: patchReactionList(base.body, args.content, args.active),
          };
        }
        return {
          ...base,
          comments: {
            ...base.comments,
            [args.subjectId]: patchReactionList(
              base.comments[args.subjectId] ?? [],
              args.content,
              args.active,
            ),
          },
        };
      });
      return { prev };
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.prev !== undefined) {
        queryClient.setQueryData(reactionsKey, ctx.prev);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: reactionsKey }),
  });
}

export function useDiscussionMeta(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "discussion-meta"] as const,
    queryFn: () => api.ghDiscussionCategories(repo),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useDiscussionList(
  repo: string,
  enabled: boolean,
  category: string | null,
) {
  return useQuery({
    queryKey: ["repo", repo, "discussion-list", category ?? "all"] as const,
    queryFn: () => api.ghDiscussionList(repo, category),
    enabled,
    staleTime: 30_000,
  });
}

const discussionDetailsOptions = (repo: string, number: number) =>
  queryOptions({
    queryKey: ["repo", repo, "discussion", number] as const,
    queryFn: () => api.ghDiscussionView(repo, number),
    staleTime: 30_000,
  });

export function useDiscussionDetails(repo: string, number: number | null) {
  return useQuery({
    ...discussionDetailsOptions(repo, number ?? 0),
    enabled: number !== null,
    placeholderData: keepPreviousData,
  });
}

export function usePrefetchDiscussion(repo: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (number: number) => {
      queryClient.prefetchQuery(discussionDetailsOptions(repo, number));
    },
    [queryClient, repo],
  );
}

export function useCreateDiscussion(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      repoId: string;
      categoryId: string;
      title: string;
      body: string;
    }) =>
      api.ghDiscussionCreate(
        repo,
        args.repoId,
        args.categoryId,
        args.title,
        args.body,
      ),
  );
}

export function useAddDiscussionComment(repo: string) {
  return useRepoMutation(
    repo,
    (args: { discussionId: string; body: string; replyToId?: string | null }) =>
      api.ghDiscussionAddComment(
        repo,
        args.discussionId,
        args.body,
        args.replyToId ?? null,
      ),
  );
}

export function useMarkDiscussionAnswer(repo: string) {
  return useRepoMutation(
    repo,
    (args: { commentId: string; answer: boolean }) =>
      args.answer
        ? api.ghDiscussionMarkAnswer(repo, args.commentId)
        : api.ghDiscussionUnmarkAnswer(repo, args.commentId),
  );
}

export function useUpdateDiscussionComment(repo: string) {
  return useRepoMutation(repo, (args: { commentId: string; body: string }) =>
    api.ghDiscussionUpdateComment(repo, args.commentId, args.body),
  );
}

export function useDeleteDiscussionComment(repo: string) {
  return useRepoMutation(repo, (commentId: string) =>
    api.ghDiscussionDeleteComment(repo, commentId),
  );
}

/** Optimistic upvote toggle on a discussion or its comments, with rollback. */
export function useToggleDiscussionUpvote(repo: string, number: number) {
  const queryClient = useQueryClient();
  const key = ["repo", repo, "discussion", number] as const;
  return useMutation({
    mutationFn: (args: { subjectId: string; up: boolean }) =>
      api.ghDiscussionSetUpvote(repo, args.subjectId, args.up),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<DiscussionDetails>(key);
      const delta = args.up ? 1 : -1;
      queryClient.setQueryData<DiscussionDetails>(key, (d) =>
        !d
          ? d
          : args.subjectId === d.id
            ? {
                ...d,
                upvoteCount: d.upvoteCount + delta,
                viewerHasUpvoted: args.up,
              }
            : {
                ...d,
                comments: d.comments.map((c) =>
                  c.id === args.subjectId
                    ? {
                        ...c,
                        upvoteCount: c.upvoteCount + delta,
                        viewerHasUpvoted: args.up,
                      }
                    : c,
                ),
              },
      );
      return { prev };
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      // The discussion list shows upvote counts too.
      queryClient.invalidateQueries({
        queryKey: ["repo", repo, "discussion-list"],
      });
    },
  });
}

export function useLockDiscussion(repo: string) {
  return useRepoMutation(
    repo,
    (args: { discussionId: string; reason: api.DiscussionLockReason | null }) =>
      api.ghDiscussionLock(repo, args.discussionId, args.reason),
  );
}

export function useUnlockDiscussion(repo: string) {
  return useRepoMutation(repo, (discussionId: string) =>
    api.ghDiscussionUnlock(repo, discussionId),
  );
}

export function useCloseDiscussion(repo: string) {
  return useRepoMutation(
    repo,
    (args: { discussionId: string; reason: api.DiscussionCloseReason }) =>
      api.ghDiscussionClose(repo, args.discussionId, args.reason),
  );
}

export function useReopenDiscussion(repo: string) {
  return useRepoMutation(repo, (discussionId: string) =>
    api.ghDiscussionReopen(repo, discussionId),
  );
}

export function useDeleteDiscussion(repo: string) {
  return useRepoMutation(repo, (discussionId: string) =>
    api.ghDiscussionDelete(repo, discussionId),
  );
}

export function useDiscussionReactions(repo: string, number: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "discussion", number ?? 0, "reactions"] as const,
    queryFn: () => api.ghDiscussionReactions(repo, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  });
}

export function useCommentIssue(repo: string) {
  return useRepoMutation(repo, (args: { number: number; body: string }) =>
    api.ghIssueComment(repo, args.number, args.body),
  );
}

export function useCloseIssue(repo: string) {
  return useRepoMutation(repo, (args: { number: number; reason: string }) =>
    api.ghIssueClose(repo, args.number, args.reason),
  );
}

export function useReopenIssue(repo: string) {
  return useRepoMutation(repo, (number: number) =>
    api.ghIssueReopen(repo, number),
  );
}

export function useEditIssue(repo: string) {
  return useRepoMutation(
    repo,
    (args: { number: number; title: string; body: string }) =>
      api.ghIssueEdit(repo, args.number, args.title, args.body),
  );
}

export function useTransferIssue(repo: string) {
  return useRepoMutation(
    repo,
    (args: { number: number; destination: string }) =>
      api.ghIssueTransfer(repo, args.number, args.destination),
  );
}

export function useDeleteIssue(repo: string) {
  return useRepoMutation(repo, (number: number) =>
    api.ghIssueDelete(repo, number),
  );
}

/** An issue's parent + sub-issues, loaded alongside the conversation. */
export function useIssueRelations(repo: string, number: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "issue", number ?? 0, "relations"] as const,
    queryFn: () => api.ghIssueRelations(repo, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  });
}

export function useAddSubIssue(repo: string) {
  return useRepoMutation(
    repo,
    (args: { parentId: string; subNumber: number }) =>
      api.ghIssueAddSubIssue(repo, args.parentId, args.subNumber),
  );
}

/** An issue's blocked-by / blocking dependencies. */
export function useIssueDependencies(repo: string, number: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "issue", number ?? 0, "dependencies"] as const,
    queryFn: () => api.ghIssueDependencies(repo, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  });
}

/** An issue's "Development" links: closing PRs + linked branches. */
export function useIssueDevelopment(repo: string, number: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "issue", number ?? 0, "development"] as const,
    queryFn: () => api.ghIssueDevelopment(repo, number ?? 0),
    enabled: number !== null,
    staleTime: 30_000,
  });
}

export function useCreateLinkedBranch(repo: string) {
  return useRepoMutation(repo, (args: { issueId: string; name: string }) =>
    api.ghIssueCreateLinkedBranch(repo, args.issueId, args.name),
  );
}

export function useSetIssueDependency(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      number: number;
      relation: IssueRelation;
      target: number;
      add: boolean;
    }) =>
      api.ghIssueSetDependency(
        repo,
        args.number,
        args.relation,
        args.target,
        args.add,
      ),
  );
}

export function useRemoveSubIssue(repo: string) {
  return useRepoMutation(repo, (args: { parentId: string; subId: string }) =>
    api.ghIssueRemoveSubIssue(repo, args.parentId, args.subId),
  );
}

export function useGhAccounts() {
  return useQuery({
    queryKey: ["gh-accounts"] as const,
    queryFn: api.ghAccounts,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSwitchAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (login: string) => api.ghSwitchAccount(login),
    // The active account changes what every gh query returns.
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useGhStatus(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "gh-status"] as const,
    // Cold-start test mode can force the "GitHub not connected" empty states.
    queryFn: COLD_START_NO_GH
      ? (): Promise<GhStatus> =>
          Promise.resolve({
            installed: false,
            authenticated: false,
            login: null,
            repo: null,
          })
      : () => api.ghStatus(repo),
    staleTime: 60_000,
    retry: false,
  });
}

// ── Git hooks ────────────────────────────────────────────────────────────────

export function useHooks(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "hooks"] as const,
    queryFn: () => api.gitHooksList(repo),
  });
}

/** A hook's script content, loaded when one is selected for editing. */
export function useHookContent(repo: string, name: string | null) {
  return useQuery({
    queryKey: ["repo", repo, "hook", name] as const,
    queryFn: () => api.gitHookRead(repo, name ?? ""),
    enabled: name !== null,
  });
}

export function useWriteHook(repo: string) {
  return useRepoMutation(repo, (args: { name: string; content: string }) =>
    api.gitHookWrite(repo, args.name, args.content),
  );
}

export function useSetHookEnabled(repo: string) {
  return useRepoMutation(repo, (args: { name: string; enabled: boolean }) =>
    api.gitHookSetEnabled(repo, args.name, args.enabled),
  );
}

export function useDeleteHook(repo: string) {
  return useRepoMutation(repo, (name: string) => api.gitHookDelete(repo, name));
}

export function useRunHookManager(repo: string) {
  return useRepoMutation(
    repo,
    (args: { manager: string; action: "install" | "update" }) =>
      api.gitRunHookManager(repo, args.manager, args.action),
  );
}

/** Every repo the signed-in user can access (clone dialog). */
export function useGhRepos(enabled: boolean) {
  return useQuery({
    queryKey: ["gh-repos"] as const,
    queryFn: api.ghListRepos,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Builds a mutation that invalidates repo queries when it settles. By default it
 * invalidates the entire repo subtree (correct but broad); pass `invalidateKeys`
 * to narrow it for hot mutations (each key is prefix-matched, react-query's
 * default). Reserve the whole-subtree default for ops that touch history or
 * branch topology (checkout/pull/reset/commit/merge).
 */
function useRepoMutation<TArgs, TData>(
  repo: string,
  mutationFn: (args: TArgs) => Promise<TData>,
  invalidateKeys?: readonly (readonly unknown[])[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      for (const queryKey of invalidateKeys ?? [repoKeys.all(repo)]) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useStage(repo: string) {
  return useRepoMutation(
    repo,
    (paths: string[]) => api.gitStage(repo, paths),
    workingTreeKeys(repo),
  );
}

export function useRemoteUrl(repo: string, name: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "remote-url", name] as const,
    queryFn: () => api.gitRemoteUrl(repo, name),
    enabled,
  });
}

export function useSetRemoteUrl(repo: string) {
  return useRepoMutation(repo, (args: { name: string; url: string }) =>
    api.gitRemoteSetUrl(repo, args.name, args.url),
  );
}

export function useOpState(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "op-state"] as const,
    queryFn: () => api.gitOpState(repo),
  });
}

export function useOpAbort(repo: string) {
  return useRepoMutation(repo, (op: RepoOp) => api.gitOpAbort(repo, op));
}

export function useOpContinue(repo: string) {
  return useRepoMutation(repo, (op: RepoOp) => api.gitOpContinue(repo, op));
}

export function useFileAtRev(
  repo: string,
  rev: string | null,
  file: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "file-b64", rev ?? "worktree", file] as const,
    queryFn: () => api.gitFileBase64(repo, rev, file),
    enabled,
  });
}

export function useApplyPatch(repo: string) {
  return useRepoMutation(
    repo,
    (args: { patch: string; cached: boolean; reverse: boolean }) =>
      api.gitApplyPatch(repo, args.patch, args.cached, args.reverse),
    workingTreeKeys(repo),
  );
}

export function useApplyPartial(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      diffText: string;
      selected: api.SelectedLine[];
      cached: boolean;
      reverse: boolean;
    }) =>
      api.gitApplyPartial(
        repo,
        args.diffText,
        args.selected,
        args.cached,
        args.reverse,
      ),
    workingTreeKeys(repo),
  );
}

export function useUnstage(repo: string) {
  return useRepoMutation(
    repo,
    (paths: string[]) => api.gitUnstage(repo, paths),
    workingTreeKeys(repo),
  );
}

export function useCommit(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { title: string; body?: string; amend?: boolean }) =>
      api.gitCommit(repo, args.title, args.body, args.amend ?? false),
    // Refetch BEFORE caller onSuccess runs (react-query awaits this), so the
    // emptied changes list, cleared draft, and success toast land together
    // instead of the toast firing while the list still shows old entries.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: repoKeys.all(repo) }),
  });
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
  return useRepoMutation(
    repo,
    (args: { path: string; untracked: boolean }) =>
      api.gitDiscard(repo, args.path, args.untracked),
    workingTreeKeys(repo),
  );
}

export function useAppendToGitignore(repo: string) {
  return useRepoMutation(repo, (patterns: string[]) =>
    api.appendToGitignore(repo, patterns),
  );
}

export function useUntrack(repo: string) {
  return useRepoMutation(
    repo,
    (args: { pathspecs: string[]; ignorePatterns: string[] }) =>
      api.gitUntrack(repo, args.pathspecs, args.ignorePatterns),
  );
}

/** Every file git tracks — for the Repository files manager. Fetched lazily. */
export function useTrackedFiles(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "tracked-files"] as const,
    queryFn: () => api.gitListTracked(repo),
    enabled,
    staleTime: 30_000,
  });
}

/** Files git ignores, with the rule responsible for each. Fetched lazily. */
export function useIgnoredFiles(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "ignored-files"] as const,
    queryFn: () => api.gitIgnoredFiles(repo),
    enabled,
    staleTime: 30_000,
  });
}

export function useForceAdd(repo: string) {
  return useRepoMutation(repo, (pathspecs: string[]) =>
    api.gitForceAdd(repo, pathspecs),
  );
}

export function useUnignoreRules(repo: string) {
  return useRepoMutation(repo, (rules: UnignoreRule[]) =>
    api.gitUnignoreRules(repo, rules),
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

export function useRewriteCommits(repo: string) {
  return useRepoMutation(repo, (args: { base: string; steps: RewriteStep[] }) =>
    api.gitRewriteCommits(repo, args.base, args.steps),
  );
}

export function usePushTag(repo: string) {
  return useRepoMutation(repo, (name: string) => api.gitPushTag(repo, name));
}

export function useDeleteTag(repo: string) {
  return useRepoMutation(repo, (args: { name: string; onRemote: boolean }) =>
    api.gitDeleteTag(repo, args.name, args.onRemote),
  );
}

// ── Tags & Releases ──────────────────────────────────────────────────────────

export function useTagList(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "tags"] as const,
    queryFn: () => api.gitListTags(repo),
    staleTime: 30_000,
  });
}

/** Recent commits, for the release-target picker. */
export function useRecentCommits(
  repo: string,
  limit: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "recent-commits", limit] as const,
    queryFn: () => api.gitRecentCommits(repo, limit),
    enabled,
    staleTime: 30_000,
  });
}

export function useReleaseList(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "releases"] as const,
    queryFn: () => api.ghReleaseList(repo),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

const releaseDetailsOptions = (repo: string, tag: string) =>
  queryOptions({
    queryKey: ["repo", repo, "release", tag] as const,
    queryFn: () => api.ghReleaseView(repo, tag),
    staleTime: 30_000,
    // A plain tag has no release → gh 404s; the detail treats that as "no
    // release", so don't retry the expected miss.
    retry: false,
  });

export function useReleaseDetails(repo: string, tag: string | null) {
  return useQuery({
    ...releaseDetailsOptions(repo, tag ?? ""),
    enabled: tag !== null,
    placeholderData: keepPreviousData,
  });
}

export function usePrefetchRelease(repo: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (tag: string) =>
      queryClient.prefetchQuery(releaseDetailsOptions(repo, tag)),
    [queryClient, repo],
  );
}

export function useCreateRelease(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      tag: string;
      title: string;
      notes: string;
      target: string;
      prerelease: boolean;
      draft: boolean;
      latest: boolean;
    }) =>
      api.ghReleaseCreate(
        repo,
        args.tag,
        args.title,
        args.notes,
        args.target,
        args.prerelease,
        args.draft,
        args.latest,
      ),
  );
}

export function useEditRelease(repo: string) {
  return useRepoMutation(
    repo,
    (args: {
      tag: string;
      title: string;
      notes: string;
      prerelease: boolean;
      draft: boolean;
      latest: boolean;
    }) =>
      api.ghReleaseEdit(
        repo,
        args.tag,
        args.title,
        args.notes,
        args.prerelease,
        args.draft,
        args.latest,
      ),
  );
}

/** GitHub's auto-generated release notes (for the preview-then-edit flow). */
export function useGithubReleaseNotes(repo: string) {
  return useMutation({
    mutationFn: (args: { tag: string; target: string; previousTag: string }) =>
      api.ghReleaseGenerateNotes(repo, args.tag, args.target, args.previousTag),
  });
}

export function useDeleteRelease(repo: string) {
  return useRepoMutation(repo, (args: { tag: string; cleanupTag: boolean }) =>
    api.ghReleaseDelete(repo, args.tag, args.cleanupTag),
  );
}

export function useUploadReleaseAsset(repo: string) {
  return useRepoMutation(repo, (args: { tag: string; filePath: string }) =>
    api.ghReleaseUploadAsset(repo, args.tag, args.filePath),
  );
}

export function useDeleteReleaseAsset(repo: string) {
  return useRepoMutation(repo, (args: { tag: string; assetName: string }) =>
    api.ghReleaseDeleteAsset(repo, args.tag, args.assetName),
  );
}

/** Asset download — no cache to invalidate, so a plain mutation. */
export function useDownloadReleaseAsset(repo: string) {
  return useMutation({
    mutationFn: (args: { tag: string; assetName: string; dir: string }) =>
      api.ghReleaseDownloadAsset(repo, args.tag, args.assetName, args.dir),
  });
}

export function useFetchRemote(repo: string) {
  return useRepoMutation(repo, () => api.gitFetch(repo));
}

export function usePull(repo: string) {
  return useRepoMutation(repo, (mode: api.PullMode = "ffOnly") =>
    api.gitPull(repo, mode),
  );
}

export function useSubmodules(repo: string) {
  return useQuery({
    queryKey: ["repo", repo, "submodules"] as const,
    queryFn: () => api.gitSubmodules(repo),
    staleTime: 30_000,
  });
}

export function useUpdateSubmodule(repo: string) {
  return useRepoMutation(repo, (path?: string) =>
    api.gitSubmoduleUpdate(repo, path),
  );
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

export function useSetBranchArchived(repo: string) {
  return useRepoMutation(repo, (args: { name: string; archived: boolean }) =>
    api.gitSetBranchArchived(repo, args.name, args.archived),
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

export function useDiscardPaths(repo: string) {
  return useRepoMutation(
    repo,
    (paths: { path: string; untracked: boolean }[]) =>
      api.gitDiscardPaths(repo, paths),
  );
}

export function useStashAll(repo: string) {
  return useRepoMutation(repo, () => api.gitStashAll(repo));
}

export function useStashPaths(repo: string) {
  return useRepoMutation(repo, (paths: string[]) =>
    api.gitStashPaths(repo, paths),
  );
}

export function useStashPop(repo: string) {
  return useRepoMutation(repo, () => api.gitStashPop(repo));
}

export function useStashList(repo: string, enabled = true) {
  return useQuery({
    queryKey: ["repo", repo, "stashes"] as const,
    queryFn: () => api.gitStashList(repo),
    enabled,
  });
}

export function useStashFiles(repo: string, index: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "stash-files", index ?? -1] as const,
    queryFn: () => api.gitStashFiles(repo, index ?? 0),
    enabled: index !== null,
    placeholderData: keepPreviousData,
  });
}

export function useStashFileDiff(
  repo: string,
  index: number | null,
  filePath: string | null,
) {
  return useQuery({
    queryKey: [
      "repo",
      repo,
      "stash-diff",
      index ?? -1,
      filePath ?? "",
    ] as const,
    queryFn: () => api.gitStashFileDiff(repo, index ?? 0, filePath ?? ""),
    enabled: index !== null && filePath !== null,
    placeholderData: keepPreviousData,
  });
}

export function useStashApply(repo: string) {
  return useRepoMutation(repo, (args: { index: number; pop: boolean }) =>
    api.gitStashApply(repo, args.index, args.pop),
  );
}

export function useStashDrop(repo: string) {
  return useRepoMutation(repo, (index: number) =>
    api.gitStashDrop(repo, index),
  );
}

export function useMergeBranch(repo: string) {
  return useRepoMutation(repo, (args: { branch: string; squash: boolean }) =>
    api.gitMerge(repo, args.branch, args.squash),
  );
}

export function useRebaseBranch(repo: string) {
  return useRepoMutation(repo, (branch: string) => api.gitRebase(repo, branch));
}

/**
 * Ahead/behind of every local branch vs. `base`. Gated on `enabled` so it only
 * runs while the branch menu is open (it's N rev-list calls), and keyed under
 * the repo so branch mutations invalidate it.
 */
export function useBranchDivergence(
  repo: string,
  base: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "divergence", base] as const,
    queryFn: () => api.gitBranchDivergence(repo, base ?? ""),
    enabled: enabled && Boolean(base),
  });
}

export function useUpdateBranchFrom(repo: string) {
  return useRepoMutation(repo, (args: { branch: string; base: string }) =>
    api.gitUpdateBranchFrom(repo, args.branch, args.base),
  );
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

export function useReopenPr(repo: string) {
  return useRepoMutation(repo, (number: number) =>
    api.ghPrReopen(repo, number),
  );
}

export function useEditPrComment(repo: string) {
  return useRepoMutation(repo, (args: { commentId: string; body: string }) =>
    api.ghPrEditComment(repo, args.commentId, args.body),
  );
}

export function useDeletePrComment(repo: string) {
  return useRepoMutation(repo, (commentId: string) =>
    api.ghPrDeleteComment(repo, commentId),
  );
}

export function useMinimizeComment(repo: string) {
  return useRepoMutation(
    repo,
    (args: { commentId: string; classifier: api.MinimizeReason }) =>
      api.ghPrMinimizeComment(repo, args.commentId, args.classifier),
  );
}

export function useUnminimizeComment(repo: string) {
  return useRepoMutation(repo, (commentId: string) =>
    api.ghPrUnminimizeComment(repo, commentId),
  );
}

export function useCheckoutPr(repo: string) {
  return useRepoMutation(repo, (number: number) =>
    api.ghPrCheckout(repo, number),
  );
}

export function useForkRepo(repo: string) {
  return useRepoMutation(repo, (contributeToParent: boolean) =>
    api.ghRepoFork(repo, contributeToParent),
  );
}

export function useRepoStarStatus(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "star-status"] as const,
    queryFn: () => api.ghRepoStarStatus(repo),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSetRepoStar(repo: string) {
  const queryClient = useQueryClient();
  const key = ["repo", repo, "star-status"] as const;
  return useMutation({
    mutationFn: (starred: boolean) => api.ghRepoSetStar(repo, starred),
    // Optimistic: flip the cached star state at once, roll back on failure.
    onMutate: async (starred: boolean) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<boolean>(key);
      queryClient.setQueryData<boolean>(key, starred);
      return { previous };
    },
    onError: (_e, _starred, ctx) => {
      if (ctx) queryClient.setQueryData(key, ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useRepoAdmin(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "admin"] as const,
    queryFn: () => api.ghRepoAdmin(repo),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

const webhooksKey = (repo: string) => ["repo", repo, "webhooks"] as const;

export function useWebhooks(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: webhooksKey(repo),
    queryFn: () => api.ghHooksList(repo),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

function useWebhookMutation<TArgs, TData>(
  repo: string,
  mutationFn: (args: TArgs) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    // Refetch the list so created/edited hooks and ping/test delivery results
    // (last response) show immediately.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: webhooksKey(repo) }),
  });
}

export function useCreateWebhook(repo: string) {
  return useWebhookMutation(repo, (input: WebhookInput) =>
    api.ghHookCreate(repo, input),
  );
}

export function useUpdateWebhook(repo: string) {
  return useWebhookMutation(repo, (args: { id: number; input: WebhookInput }) =>
    api.ghHookUpdate(repo, args.id, args.input),
  );
}

export function useDeleteWebhook(repo: string) {
  return useWebhookMutation(repo, (id: number) => api.ghHookDelete(repo, id));
}

export function usePingWebhook(repo: string) {
  return useWebhookMutation(repo, (id: number) => api.ghHookPing(repo, id));
}

export function useTestWebhook(repo: string) {
  return useWebhookMutation(repo, (id: number) => api.ghHookTest(repo, id));
}

const deliveriesKey = (repo: string, hookId: number) =>
  ["repo", repo, "webhook-deliveries", hookId] as const;

export function useWebhookDeliveries(
  repo: string,
  hookId: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: deliveriesKey(repo, hookId),
    queryFn: () => api.ghHookDeliveries(repo, hookId),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

export function useWebhookDelivery(
  repo: string,
  hookId: number,
  deliveryId: string | null,
) {
  return useQuery({
    queryKey: ["repo", repo, "webhook-delivery", hookId, deliveryId] as const,
    queryFn: () => api.ghHookDelivery(repo, hookId, deliveryId as string),
    // A past delivery is immutable, so it never goes stale once fetched.
    enabled: deliveryId != null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useRedeliverWebhook(repo: string, hookId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) =>
      api.ghHookRedeliver(repo, hookId, deliveryId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: deliveriesKey(repo, hookId) }),
  });
}

const repoSettingsKey = (repo: string) =>
  ["repo", repo, "repo-settings"] as const;

export function useRepoSettings(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: repoSettingsKey(repo),
    queryFn: () => api.ghRepoSettingsGet(repo),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useUpdateRepoSettings(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RepoSettingsInput) =>
      api.ghRepoSettingsUpdate(repo, input),
    // The PATCH returns the fresh settings — seed the cache, then refetch.
    onSuccess: (data) => queryClient.setQueryData(repoSettingsKey(repo), data),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: repoSettingsKey(repo) }),
  });
}

export function useReadyPr(repo: string) {
  return useRepoMutation(repo, (number: number) => api.ghPrReady(repo, number));
}

export function useEditPr(repo: string) {
  return useRepoMutation(
    repo,
    (args: { number: number; title: string; body: string }) =>
      api.ghPrEdit(repo, args.number, args.title, args.body),
  );
}

export function useEditPrLabels(repo: string) {
  return useRepoMutation(
    repo,
    (args: { labelableId: string; addIds: string[]; removeIds: string[] }) =>
      api.ghPrEditLabels(repo, args.labelableId, args.addIds, args.removeIds),
  );
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
