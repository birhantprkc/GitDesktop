import { invoke } from "@/lib/tauri/invoke";
import {
  COLD_START,
  coldStartDeleteSecret,
  coldStartGetSecret,
  coldStartSetSecret,
} from "@/lib/test-mode";
import type {
  ApprovalState,
  BlameLine,
  Branch,
  BranchComparison,
  BranchDivergence,
  BranchStats,
  CodeFreqPoint,
  Collaborator,
  CommitAuthor,
  CommitDetails,
  CommitResult,
  CommitSummary,
  CommunityInsights,
  ContributorChurn,
  DeltaDiff,
  DiffStatEntry,
  DiscussionDetails,
  DiscussionInfo,
  DiscussionMeta,
  ExternalReviewItem,
  FileDiff,
  ForgeProvider,
  ForgeRepoList,
  ForgeStatus,
  GeneratedNotes,
  GhAccounts,
  GhBranchProtection,
  GhRepoList,
  GhScopes,
  GhSecret,
  GhVariable,
  GitInfo,
  HookDelivery,
  HookDeliveryDetail,
  HooksInfo,
  IgnoredFile,
  Invitation,
  IssueDependencies,
  IssueDetails,
  IssueDevelopment,
  IssueInfo,
  IssueReactions,
  IssueRelation,
  IssueRelations,
  IssueType,
  MergePreview,
  Milestone,
  PagesInfo,
  PrDetails,
  PrInfo,
  PrPollInfo,
  PrRef,
  PunchCard,
  ReleaseDetails,
  ReleaseInfo,
  RemoteBranch,
  RepoDependencies,
  RepoInfo,
  RepoLabel,
  RepoOp,
  RepoOpState,
  RepoOwner,
  RepoRole,
  RepoSettings,
  RepoSettingsInput,
  RepoStats,
  RepoStatus,
  RepoTraffic,
  RewriteStep,
  RulesetEnforcement,
  RulesetFull,
  RulesetSummary,
  SecretApp,
  SecurityFeature,
  SecurityStatus,
  StagedDiff,
  StashEntry,
  StashFile,
  Submodule,
  TagInfo,
  UnignoreRule,
  Webhook,
  WebhookInput,
  WeekCount,
} from "./types";

export const checkGitInstalled = () => invoke<GitInfo>("check_git_installed");

export const validateRepo = (path: string) =>
  invoke<RepoInfo>("validate_repo", { path });

export const cloneRepo = (url: string, parentDir: string, dirName?: string) =>
  invoke<string>("clone_repo", { url, parentDir, dirName: dirName ?? null });

export interface CreateRepoOptions {
  name: string;
  description: string;
  parentDir: string;
  initReadme: boolean;
  gitignore: string | null;
  license: string | null;
  defaultBranch: string;
}

export const createRepo = (options: CreateRepoOptions) =>
  invoke<string>("create_repo", { options });

export const gitStatus = (repoPath: string) =>
  invoke<RepoStatus>("git_status", { repoPath });

export const gitBranches = (repoPath: string) =>
  invoke<Branch[]>("git_branches", { repoPath });

export const gitRemoteBranches = (repoPath: string) =>
  invoke<RemoteBranch[]>("git_remote_branches", { repoPath });

export const gitRepoOwners = (repoPaths: string[]) =>
  invoke<RepoOwner[]>("git_repo_owners", { repoPaths });

export const gitCheckoutBranch = (repoPath: string, name: string) =>
  invoke<void>("git_checkout_branch", { repoPath, name });

export const gitCreateBranch = (
  repoPath: string,
  name: string,
  checkout: boolean,
  startPoint?: string,
) =>
  invoke<void>("git_create_branch", {
    repoPath,
    name,
    checkout,
    startPoint: startPoint ?? null,
  });

export const gitDiffFile = (
  repoPath: string,
  filePath: string,
  staged: boolean,
  untracked: boolean,
) =>
  invoke<FileDiff>("git_diff_file", { repoPath, filePath, staged, untracked });

/** A single file's cumulative diff in an agent session worktree, against the
 *  session's base commit (committed turns + uncommitted edits; new untracked
 *  files show as a full add). Powers the inline edit-step diff in the transcript. */
export const gitSessionFileDiff = (
  repoPath: string,
  filePath: string,
  base: string,
) => invoke<FileDiff>("git_session_file_diff", { repoPath, filePath, base });

/** Staged diff vs HEAD. With `worktree: true` it instead returns ALL in-progress
 *  tracked changes (staged + unstaged) vs HEAD — for naming a branch off work
 *  that may not be staged yet. Untracked files are never included (callers pass
 *  their paths from the status entries separately). */
export const gitStagedDiff = (
  repoPath: string,
  opts: { maxBytes?: number; exclude?: string[]; worktree?: boolean } = {},
) =>
  invoke<StagedDiff>("git_staged_diff", {
    repoPath,
    maxBytes: opts.maxBytes ?? null,
    exclude: opts.exclude ?? null,
    // Only send the flag when set, matching the prior two-function behaviour.
    ...(opts.worktree ? { worktree: true } : {}),
  });

export const gitStage = (repoPath: string, paths: string[]) =>
  invoke<void>("git_stage", { repoPath, paths });

export const gitUnstage = (repoPath: string, paths: string[]) =>
  invoke<void>("git_unstage", { repoPath, paths });

export const gitCommit = (
  repoPath: string,
  title: string,
  body?: string,
  amend = false,
) =>
  invoke<CommitResult>("git_commit", {
    repoPath,
    title,
    body: body ?? null,
    amend,
  });

export const gitStashList = (repoPath: string) =>
  invoke<StashEntry[]>("git_stash_list", { repoPath });

export const gitStashFiles = (repoPath: string, index: number) =>
  invoke<StashFile[]>("git_stash_files", { repoPath, index });

export const gitStashFileDiff = (
  repoPath: string,
  index: number,
  filePath: string,
) => invoke<FileDiff>("git_stash_file_diff", { repoPath, index, filePath });

export const gitStashApply = (repoPath: string, index: number, pop: boolean) =>
  invoke<void>("git_stash_apply", { repoPath, index, pop });

export const gitStashDrop = (repoPath: string, index: number) =>
  invoke<void>("git_stash_drop", { repoPath, index });

export const gitOpState = (repoPath: string) =>
  invoke<RepoOpState>("git_op_state", { repoPath });

export const gitOpAbort = (repoPath: string, op: RepoOp) =>
  invoke<void>("git_op_abort", { repoPath, op });

export const gitOpContinue = (repoPath: string, op: RepoOp) =>
  invoke<void>("git_op_continue", { repoPath, op });

/** Base64 file content at a rev (null rev = working tree; null result = absent). */
export const gitFileBase64 = (
  repoPath: string,
  rev: string | null,
  filePath: string,
) => invoke<string | null>("git_file_base64", { repoPath, rev, filePath });

export const gitApplyPatch = (
  repoPath: string,
  patch: string,
  cached: boolean,
  reverse: boolean,
) => invoke<void>("git_apply_patch", { repoPath, patch, cached, reverse });

/** One selected changed line for partial staging. */
export interface SelectedLine {
  side: "old" | "new";
  line: number;
}

/** Stage/unstage/discard a selected subset of lines from a file's diff. */
export const gitApplyPartial = (
  repoPath: string,
  diffText: string,
  selected: SelectedLine[],
  cached: boolean,
  reverse: boolean,
) =>
  invoke<void>("git_apply_partial", {
    repoPath,
    diffText,
    selected,
    cached,
    reverse,
  });

export const gitCommitAuthors = (repoPath: string) =>
  invoke<CommitAuthor[]>("git_commit_authors", { repoPath });

export const gitUserIdentity = (repoPath: string) =>
  invoke<CommitAuthor>("git_user_identity", { repoPath });

export const gitLocalIdentity = (repoPath: string) =>
  invoke<CommitAuthor>("git_local_identity", { repoPath });

export const gitSetLocalIdentity = (
  repoPath: string,
  name: string,
  email: string,
) => invoke<void>("git_set_local_identity", { repoPath, name, email });

export const gitGlobalIdentity = () =>
  invoke<CommitAuthor>("git_global_identity");

export const gitSetGlobalIdentity = (name: string, email: string) =>
  invoke<void>("git_set_global_identity", { name, email });

export const gitGlobalDefaultBranch = () =>
  invoke<string>("git_global_default_branch");

export const gitSetGlobalDefaultBranch = (branch: string) =>
  invoke<void>("git_set_global_default_branch", { branch });

export const gitGlobalAutocrlf = () => invoke<string>("git_global_autocrlf");

export const gitSetGlobalAutocrlf = (value: string) =>
  invoke<void>("git_set_global_autocrlf", { value });

export const gitCommitDiff = (
  repoPath: string,
  hash: string,
  maxBytes?: number,
) =>
  invoke<StagedDiff>("git_commit_diff", {
    repoPath,
    hash,
    maxBytes: maxBytes ?? null,
  });

export const gitDiscard = (
  repoPath: string,
  path: string,
  untracked: boolean,
) => invoke<void>("git_discard", { repoPath, path, untracked });

/** Discards selected lines from an untracked (new) file — removes just those
 *  1-based line numbers and rewrites it in place (the file stays untracked).
 *  Used for line/hunk discard of a new file, where reverse-applying a patch
 *  would delete the whole file instead. */
export const gitDiscardUntrackedLines = (
  repoPath: string,
  path: string,
  lines: number[],
) => invoke<void>("git_discard_untracked_lines", { repoPath, path, lines });

export const gitReset = (repoPath: string, hash: string) =>
  invoke<void>("git_reset", { repoPath, hash });

export const gitCheckoutCommit = (repoPath: string, hash: string) =>
  invoke<void>("git_checkout_commit", { repoPath, hash });

export const gitRevert = (repoPath: string, hash: string) =>
  invoke<void>("git_revert", { repoPath, hash });

/** Resolves true when a commit was created, false when there was nothing
 *  to apply (the changes already exist on this branch). */
export const gitCherryPick = (repoPath: string, hash: string) =>
  invoke<boolean>("git_cherry_pick", { repoPath, hash });

export interface CherryPickRangeResult {
  applied: number;
  skipped: number;
}

/** Copies `hashes` (oldest-first) onto `targetBranch` and leaves you there.
 *  Rolls back entirely if any commit conflicts. */
export const gitCherryPickOnto = (
  repoPath: string,
  hashes: string[],
  targetBranch: string,
) =>
  invoke<CherryPickRangeResult>("git_cherry_pick_onto", {
    repoPath,
    hashes,
    targetBranch,
  });

export const gitTag = (repoPath: string, name: string, hash: string) =>
  invoke<void>("git_tag", { repoPath, name, hash });

export const gitRewriteCommits = (
  repoPath: string,
  base: string,
  steps: RewriteStep[],
) => invoke<void>("git_rewrite_commits", { repoPath, base, steps });

/** Like gitRewriteCommits but via a real, resumable `git rebase -i` — used when
 *  a step is marked `edit` (pause to amend its contents). Leaves the rebase in
 *  progress for the banner to continue/abort. */
export const gitRebaseEdit = (
  repoPath: string,
  base: string,
  steps: RewriteStep[],
) => invoke<void>("git_rebase_edit", { repoPath, base, steps });

/** Full messages (subject + body) for the unpushed commits `base..HEAD`, to
 *  pre-fill the Edit-history editor without truncating multi-line bodies. */
export const gitUnpushedMessages = (repoPath: string, base: string) =>
  invoke<{ hash: string; message: string }[]>("git_unpushed_messages", {
    repoPath,
    base,
  });

export const gitPushTag = (repoPath: string, name: string) =>
  invoke<void>("git_push_tag", { repoPath, name });

export const gitDeleteTag = (
  repoPath: string,
  name: string,
  onRemote: boolean,
) => invoke<void>("git_delete_tag", { repoPath, name, onRemote });

/** Every tag in the repo, newest first (for the Tags list). */
export const gitListTags = (repoPath: string) =>
  invoke<TagInfo[]>("git_list_tags", { repoPath });

// ── Releases ────────────────────────────────────────────────────────────────
//
// Reads go through the provider-neutral `forge_release_*` (GitHub via `gh`, GitLab
// via `glab`); the GitHub path is byte-identical to the old `gh_release_*`. Writes
// (create / edit / delete / asset management) stay GitHub-only (`gh_release_*`) and
// are hidden for GitLab on the frontend.

export const forgeReleaseList = (repoPath: string) =>
  invoke<ReleaseInfo[]>("forge_release_list", { repoPath });

export const forgeReleaseView = (repoPath: string, tag: string) =>
  invoke<ReleaseDetails>("forge_release_view", { repoPath, tag });

export const ghReleaseCreate = (
  repoPath: string,
  tag: string,
  title: string,
  notes: string,
  target: string,
  prerelease: boolean,
  draft: boolean,
  latest: boolean,
) =>
  invoke<string>("gh_release_create", {
    repoPath,
    tag,
    title,
    notes,
    target,
    prerelease,
    draft,
    latest,
  });

export const ghReleaseEdit = (
  repoPath: string,
  tag: string,
  title: string,
  notes: string,
  prerelease: boolean,
  draft: boolean,
  latest: boolean,
) =>
  invoke<void>("gh_release_edit", {
    repoPath,
    tag,
    title,
    notes,
    prerelease,
    draft,
    latest,
  });

/** GitHub's auto-generated release notes (suggested title + body), for preview. */
export const ghReleaseGenerateNotes = (
  repoPath: string,
  tag: string,
  target: string,
  previousTag: string,
) =>
  invoke<GeneratedNotes>("gh_release_generate_notes", {
    repoPath,
    tag,
    target,
    previousTag,
  });

export const ghReleaseDelete = (
  repoPath: string,
  tag: string,
  cleanupTag: boolean,
) => invoke<void>("gh_release_delete", { repoPath, tag, cleanupTag });

export const ghReleaseUploadAsset = (
  repoPath: string,
  tag: string,
  filePath: string,
) => invoke<void>("gh_release_upload_asset", { repoPath, tag, filePath });

export const ghReleaseDeleteAsset = (
  repoPath: string,
  tag: string,
  assetName: string,
) => invoke<void>("gh_release_delete_asset", { repoPath, tag, assetName });

export const ghReleaseDownloadAsset = (
  repoPath: string,
  tag: string,
  assetName: string,
  dir: string,
) =>
  invoke<void>("gh_release_download_asset", { repoPath, tag, assetName, dir });

export const appendToGitignore = (repoPath: string, patterns: string[]) =>
  invoke<void>("append_to_gitignore", { repoPath, patterns });

export const gitUntrack = (
  repoPath: string,
  pathspecs: string[],
  ignorePatterns: string[],
) => invoke<void>("git_untrack", { repoPath, pathspecs, ignorePatterns });

export const gitListTracked = (repoPath: string) =>
  invoke<string[]>("git_list_tracked", { repoPath });

export const gitIgnoredFiles = (repoPath: string) =>
  invoke<IgnoredFile[]>("git_ignored_files", { repoPath });

export const gitForceAdd = (repoPath: string, pathspecs: string[]) =>
  invoke<void>("git_force_add", { repoPath, pathspecs });

export const gitUnignoreRules = (repoPath: string, rules: UnignoreRule[]) =>
  invoke<void>("git_unignore_rules", { repoPath, rules });

export const revealInExplorer = (path: string) =>
  invoke<void>("reveal_in_explorer", { path });

/** Moves a repository folder to the OS recycle bin. */
export const deleteRepoFolder = (path: string) =>
  invoke<void>("delete_repo_folder", { path });

export const openWithDefault = (path: string) =>
  invoke<void>("open_with_default", { path });

export const openInTerminal = (
  path: string,
  terminal?: string,
  program?: string,
) =>
  invoke<void>("open_in_terminal", {
    path,
    terminal: terminal || null,
    program: program || null,
  });

export const ghRepoUrl = (repoPath: string) =>
  invoke<string>("gh_repo_url", { repoPath });

export const gitRecentCommits = (repoPath: string, limit: number) =>
  invoke<CommitSummary[]>("git_recent_commits", { repoPath, limit });

export const gitLog = (
  repoPath: string,
  limit: number,
  skip: number,
  /** When set, search the whole history by commit message instead of paging. */
  search?: string,
) =>
  invoke<CommitSummary[]>("git_log", {
    repoPath,
    limit,
    skip,
    search: search ?? null,
  });

export const gitCommitDetails = (repoPath: string, hash: string) =>
  invoke<CommitDetails>("git_commit_details", { repoPath, hash });

export const gitFileLog = (
  repoPath: string,
  path: string,
  limit: number,
  skip: number,
) => invoke<CommitSummary[]>("git_file_log", { repoPath, path, limit, skip });

export const gitBlame = (repoPath: string, path: string) =>
  invoke<BlameLine[]>("git_blame", { repoPath, path });

export const gitCommitFiles = (repoPath: string, hash: string) =>
  invoke<DiffStatEntry[]>("git_commit_files", { repoPath, hash });

export const gitCommitFileDiff = (
  repoPath: string,
  hash: string,
  filePath: string,
) => invoke<FileDiff>("git_commit_file_diff", { repoPath, hash, filePath });

export const gitFetch = (repoPath: string) =>
  invoke<void>("git_fetch", { repoPath });

/** Pull mode: fast-forward only (default), or reconcile a diverged branch. */
export type PullMode = "ffOnly" | "rebase" | "merge";

export const gitPull = (repoPath: string, mode: PullMode = "ffOnly") =>
  invoke<void>("git_pull", { repoPath, mode });

export const gitPush = (
  repoPath: string,
  setUpstream: boolean,
  force = false,
) => invoke<void>("git_push", { repoPath, setUpstream, force });

export const gitRemotes = (repoPath: string) =>
  invoke<string[]>("git_remotes", { repoPath });

export const gitRemoteUrl = (repoPath: string, name: string) =>
  invoke<string>("git_remote_url", { repoPath, name });

export const gitRemoteSetUrl = (repoPath: string, name: string, url: string) =>
  invoke<void>("git_remote_set_url", { repoPath, name, url });

export const gitSubmodules = (repoPath: string) =>
  invoke<Submodule[]>("git_submodules", { repoPath });

/** Init + update submodules to the recorded commit; `path` for one, else all. */
export const gitSubmoduleUpdate = (repoPath: string, path?: string) =>
  invoke<void>("git_submodule_update", { repoPath, path: path ?? null });

export const gitUndoCommit = (repoPath: string) =>
  invoke<void>("git_undo_commit", { repoPath });

export const gitSetBranchArchived = (
  repoPath: string,
  name: string,
  archived: boolean,
) => invoke<void>("git_set_branch_archived", { repoPath, name, archived });

export const gitRenameBranch = (
  repoPath: string,
  oldName: string,
  newName: string,
) => invoke<void>("git_rename_branch", { repoPath, oldName, newName });

export const gitDeleteBranch = (repoPath: string, name: string) =>
  invoke<void>("git_delete_branch", { repoPath, name });

export const gitDefaultBranch = (repoPath: string) =>
  invoke<string | null>("git_default_branch", { repoPath });

export const gitDiscardAll = (repoPath: string) =>
  invoke<void>("git_discard_all", { repoPath });

export const gitDiscardPaths = (
  repoPath: string,
  paths: { path: string; untracked: boolean }[],
) => invoke<void>("git_discard_paths", { repoPath, paths });

export const gitStashAll = (repoPath: string) =>
  invoke<void>("git_stash_all", { repoPath });

export const gitStashPaths = (repoPath: string, paths: string[]) =>
  invoke<void>("git_stash_paths", { repoPath, paths });

export const gitStashPop = (repoPath: string) =>
  invoke<void>("git_stash_pop", { repoPath });

export const gitStashCount = (repoPath: string) =>
  invoke<number>("git_stash_count", { repoPath });

/** Conflict-auto-resolve strategy for a merge: "none" stops on conflicts,
 *  "ours"/"theirs" auto-resolve conflicting hunks via `-X`. */
export type MergeConflictStrategy = "none" | "ours" | "theirs";

export const gitMerge = (
  repoPath: string,
  branch: string,
  squash: boolean,
  noFf: boolean,
  strategy: MergeConflictStrategy,
) => invoke<void>("git_merge", { repoPath, branch, squash, noFf, strategy });

export const gitMergePreview = (
  repoPath: string,
  branch: string,
  strategy: MergeConflictStrategy,
) => invoke<MergePreview>("git_merge_preview", { repoPath, branch, strategy });

export const gitRebase = (repoPath: string, branch: string) =>
  invoke<void>("git_rebase", { repoPath, branch });

export const gitBranchDivergence = (repoPath: string, base: string) =>
  invoke<BranchDivergence[]>("git_branch_divergence", { repoPath, base });

export interface MergePair {
  base: string;
  head: string;
}

export interface BranchMergeState {
  /** `head` is fully merged into `base` (nothing left to merge). */
  merged: boolean;
  /** The `head` branch still exists locally. */
  headExists: boolean;
}

/** Per pair: whether `head` is merged into `base`, and whether `head` exists. */
export const gitBranchMergeStates = (repoPath: string, pairs: MergePair[]) =>
  invoke<BranchMergeState[]>("git_branch_merge_states", { repoPath, pairs });

/** Resolves to "up-to-date" | "fast-forward" | "merge". */
export const gitUpdateBranchFrom = (
  repoPath: string,
  branch: string,
  base: string,
) => invoke<string>("git_update_branch_from", { repoPath, branch, base });

export type MergeStrategy = "merge" | "squash" | "rebase";

export const gitMergeLocalPr = (
  repoPath: string,
  base: string,
  head: string,
  message: string,
  strategy: MergeStrategy,
) =>
  invoke<void>("git_merge_local_pr", {
    repoPath,
    base,
    head,
    message,
    strategy,
  });

export const gitRepoStats = (repoPath: string) =>
  invoke<RepoStats>("git_repo_stats", { repoPath });

/** Stats for the commits/diff `branch` has that `base` doesn't. */
export const gitBranchStats = (
  repoPath: string,
  branch: string,
  base: string,
) => invoke<BranchStats>("git_branch_stats", { repoPath, branch, base });

// Insights graphs — `weeks > 0` limits to a trailing window; `0` is all history.
export const gitContributorActivity = (repoPath: string, weeks: number) =>
  invoke<ContributorChurn[]>("git_contributor_activity", { repoPath, weeks });

export const gitCommitActivity = (repoPath: string, weeks: number) =>
  invoke<WeekCount[]>("git_commit_activity", { repoPath, weeks });

export const gitCodeFrequency = (repoPath: string, weeks: number) =>
  invoke<CodeFreqPoint[]>("git_code_frequency", { repoPath, weeks });

export const gitPunchCard = (repoPath: string, weeks: number) =>
  invoke<PunchCard>("git_punch_card", { repoPath, weeks });

export const ghCommunityInsights = (repoPath: string) =>
  invoke<CommunityInsights>("gh_community_insights", { repoPath });

export const ghRepoTraffic = (repoPath: string) =>
  invoke<RepoTraffic>("gh_repo_traffic", { repoPath });

export const ghRepoDependencies = (repoPath: string) =>
  invoke<RepoDependencies>("gh_repo_dependencies", { repoPath });

export const gitCompareBranches = (
  repoPath: string,
  base: string,
  compare: string,
) =>
  invoke<BranchComparison>("git_compare_branches", { repoPath, base, compare });

export const gitBranchDiffFiles = (
  repoPath: string,
  base: string,
  compare: string,
) =>
  invoke<DiffStatEntry[]>("git_branch_diff_files", { repoPath, base, compare });

export const gitBranchFileDiff = (
  repoPath: string,
  base: string,
  compare: string,
  filePath: string,
) =>
  invoke<FileDiff>("git_branch_file_diff", {
    repoPath,
    base,
    compare,
    filePath,
  });

export const gitBranchDiff = (
  repoPath: string,
  base: string,
  compare: string,
  maxBytes?: number,
) =>
  invoke<StagedDiff>("git_branch_diff", {
    repoPath,
    base,
    compare,
    maxBytes: maxBytes ?? null,
  });

/** The literal `fromRef..toRef` diff — "what changed since the last review".
 *  Soft, best-effort: never throws for missing/rewritten history; the result's
 *  `reason` says why the delta is absent so the caller can fall back. */
export const gitDiffBetweenRefs = (
  repoPath: string,
  fromRef: string,
  toRef: string,
  maxBytes?: number,
) =>
  invoke<DeltaDiff>("git_diff_between_refs", {
    repoPath,
    fromRef,
    toRef,
    maxBytes: maxBytes ?? null,
  });

/** Best-effort fetch of specific commit SHAs from origin, so a remote PR's
 *  prior-review delta can resolve when the PR was never checked out. Returns
 *  whether the fetch succeeded; callers treat failure as "no delta". */
export const gitFetchObjects = (repoPath: string, refs: string[]) =>
  invoke<boolean>("git_fetch_objects", { repoPath, refs });

/** Current tip SHA of each requested local branch (one for-each-ref call).
 *  Branches that don't exist are omitted. Used to watch open local PRs' heads. */
export const gitBranchTips = (repoPath: string, branches: string[]) =>
  invoke<Record<string, string>>("git_branch_tips", { repoPath, branches });

/** Creates a throwaway detached worktree at `sha` so a repo-aware CLI review
 *  reads the PR head's files without moving the active branch. Returns the
 *  worktree path, or null when one isn't needed/possible (already on that
 *  commit, object not local, or checkout failed) — caller uses the repo root. */
export const gitReviewWorktree = (repoPath: string, sha: string) =>
  invoke<string | null>("git_review_worktree", { repoPath, sha });

/** Removes a review worktree (best-effort, idempotent). */
export const gitRemoveWorktree = (repoPath: string, worktreePath: string) =>
  invoke<void>("git_remove_worktree", { repoPath, worktreePath });

/** Provider-neutral hosted-integration status (GitHub today; GitLab/Bitbucket as
 *  their impls land) — the gate hosted panels read for any provider. */
export const forgeStatus = (repoPath: string) =>
  invoke<ForgeStatus>("forge_status", { repoPath });

/** The signed-in user's repositories on a provider, for the clone browser. */
export const forgeListRepos = (provider: ForgeProvider) =>
  invoke<ForgeRepoList>("forge_list_repos", { provider });

/** Clone a repo for a provider, supplying provider auth that plain `git clone`
 *  lacks (a private GitLab repo authenticates via glab's token). Returns the
 *  cloned path. */
export const forgeClone = (
  provider: ForgeProvider,
  url: string,
  parentDir: string,
  dirName?: string,
) =>
  invoke<string>("forge_clone", {
    provider,
    url,
    parentDir,
    dirName: dirName ?? null,
  });

export const ghPrCreate = (
  repoPath: string,
  base: string,
  head: string,
  title: string,
  body: string,
  draft: boolean,
) =>
  invoke<PrRef>("gh_pr_create", {
    repoPath,
    base,
    head,
    title,
    body,
    draft,
  });

export const ghPublishRepo = (
  repoPath: string,
  name: string,
  isPrivate: boolean,
  description: string,
  homepage: string,
  topics: string[],
) =>
  invoke<string>("gh_publish_repo", {
    repoPath,
    name,
    private: isPrivate,
    description,
    homepage,
    topics,
  });

export const ghPrsForBranch = (repoPath: string, head: string) =>
  invoke<PrInfo[]>("gh_prs_for_branch", { repoPath, head });

export type PrStateFilter = "open" | "closed";

export const ghPrList = (repoPath: string, state: PrStateFilter) =>
  invoke<PrInfo[]>("gh_pr_list", { repoPath, state });

export const ghPrView = (repoPath: string, number: number) =>
  invoke<PrDetails>("gh_pr_view", { repoPath, number });

// Provider-neutral merge/pull request reads — the backend resolves the repo's
// provider and dispatches (GitHub `gh`, GitLab `glab`), returning the same neutral
// `PrInfo`/`PrDetails` shapes. The list/view/diff read path goes through these; the
// write mutations (merge/comment/edit/…) stay on the GitHub-only `gh_*` commands.
export const forgePrList = (repoPath: string, state: PrStateFilter) =>
  invoke<PrInfo[]>("forge_pr_list", { repoPath, state });

export const forgePrView = (repoPath: string, number: number) =>
  invoke<PrDetails>("forge_pr_view", { repoPath, number });

export const forgePrDiff = (repoPath: string, number: number) =>
  invoke<string>("forge_pr_diff", { repoPath, number });

export type IssueStateFilter = "open" | "closed";

// Provider-neutral issue reads — like the PR reads above, the backend resolves the
// repo's provider and dispatches (GitHub `gh`, GitLab `glab`), returning the same
// neutral `IssueInfo`/`IssueDetails` shapes. Only the read path is provider-neutral;
// the issue write mutations below stay on the GitHub-only `gh_issue_*` commands.
export const forgeIssueList = (repoPath: string, state: IssueStateFilter) =>
  invoke<IssueInfo[]>("forge_issue_list", { repoPath, state });

export const forgeIssueView = (repoPath: string, number: number) =>
  invoke<IssueDetails>("forge_issue_view", { repoPath, number });

export const ghIssueCreate = (
  repoPath: string,
  title: string,
  body: string,
  labels: string[],
  assignees: string[],
  milestone: number | null,
  issueType: string | null,
) =>
  invoke<PrRef>("gh_issue_create", {
    repoPath,
    title,
    body,
    labels,
    assignees,
    milestone,
    issueType,
  });

export const forgeAssignableUsers = (repoPath: string) =>
  invoke<string[]>("forge_assignable_users", { repoPath });

export const ghMilestones = (repoPath: string) =>
  invoke<Milestone[]>("gh_milestones", { repoPath });

export const forgeIssueSetAssignees = (
  repoPath: string,
  number: number,
  assignees: string[],
) => invoke<void>("forge_issue_set_assignees", { repoPath, number, assignees });

export const ghIssueSetMilestone = (
  repoPath: string,
  number: number,
  milestone: number | null,
) => invoke<void>("gh_issue_set_milestone", { repoPath, number, milestone });

/** The repo's enabled issue types (empty when the owner defines none). */
export const ghIssueTypes = (repoPath: string) =>
  invoke<IssueType[]>("gh_issue_types", { repoPath });

export const ghIssueSetType = (
  repoPath: string,
  number: number,
  typeName: string | null,
) => invoke<void>("gh_issue_set_type", { repoPath, number, typeName });

export const ghIssuePin = (repoPath: string, number: number) =>
  invoke<void>("gh_issue_pin", { repoPath, number });

export const ghIssueUnpin = (repoPath: string, number: number) =>
  invoke<void>("gh_issue_unpin", { repoPath, number });

export type LockReason = "off_topic" | "resolved" | "spam" | "too_heated";

export const ghIssueLock = (
  repoPath: string,
  number: number,
  reason: LockReason | null,
) => invoke<void>("gh_issue_lock", { repoPath, number, reason });

export const ghIssueUnlock = (repoPath: string, number: number) =>
  invoke<void>("gh_issue_unlock", { repoPath, number });

export const ghIssueReactions = (repoPath: string, number: number) =>
  invoke<IssueReactions>("gh_issue_reactions", { repoPath, number });

export const ghAddReaction = (
  repoPath: string,
  subjectId: string,
  content: string,
) => invoke<void>("gh_add_reaction", { repoPath, subjectId, content });

export const ghRemoveReaction = (
  repoPath: string,
  subjectId: string,
  content: string,
) => invoke<void>("gh_remove_reaction", { repoPath, subjectId, content });

/** The repo's issue templates (frontmatter stripped); empty when it has none. */
export const readIssueTemplates = (repoPath: string) =>
  invoke<string[]>("read_issue_templates", { repoPath });

export const ghDiscussionCategories = (repoPath: string) =>
  invoke<DiscussionMeta>("gh_discussion_categories", { repoPath });

export const ghDiscussionList = (repoPath: string, category: string | null) =>
  invoke<DiscussionInfo[]>("gh_discussion_list", { repoPath, category });

export const ghDiscussionView = (repoPath: string, number: number) =>
  invoke<DiscussionDetails>("gh_discussion_view", { repoPath, number });

export const ghDiscussionCreate = (
  repoPath: string,
  repoId: string,
  categoryId: string,
  title: string,
  body: string,
) =>
  invoke<PrRef>("gh_discussion_create", {
    repoPath,
    repoId,
    categoryId,
    title,
    body,
  });

export const ghDiscussionAddComment = (
  repoPath: string,
  discussionId: string,
  body: string,
  replyToId: string | null,
) =>
  invoke<void>("gh_discussion_add_comment", {
    repoPath,
    discussionId,
    body,
    replyToId,
  });

export const ghDiscussionMarkAnswer = (repoPath: string, commentId: string) =>
  invoke<void>("gh_discussion_mark_answer", { repoPath, commentId });

export const ghDiscussionUnmarkAnswer = (repoPath: string, commentId: string) =>
  invoke<void>("gh_discussion_unmark_answer", { repoPath, commentId });

export const ghDiscussionUpdateComment = (
  repoPath: string,
  commentId: string,
  body: string,
) =>
  invoke<void>("gh_discussion_update_comment", { repoPath, commentId, body });

export const ghDiscussionDeleteComment = (
  repoPath: string,
  commentId: string,
) => invoke<void>("gh_discussion_delete_comment", { repoPath, commentId });

export const ghDiscussionSetUpvote = (
  repoPath: string,
  subjectId: string,
  up: boolean,
) => invoke<void>("gh_discussion_set_upvote", { repoPath, subjectId, up });

export const ghDiscussionReactions = (repoPath: string, number: number) =>
  invoke<IssueReactions>("gh_discussion_reactions", { repoPath, number });

export type DiscussionLockReason =
  | "OFF_TOPIC"
  | "TOO_HEATED"
  | "RESOLVED"
  | "SPAM";

export const ghDiscussionLock = (
  repoPath: string,
  discussionId: string,
  reason: DiscussionLockReason | null,
) => invoke<void>("gh_discussion_lock", { repoPath, discussionId, reason });

export const ghDiscussionUnlock = (repoPath: string, discussionId: string) =>
  invoke<void>("gh_discussion_unlock", { repoPath, discussionId });

export type DiscussionCloseReason = "RESOLVED" | "OUTDATED" | "DUPLICATE";

export const ghDiscussionClose = (
  repoPath: string,
  discussionId: string,
  reason: DiscussionCloseReason,
) => invoke<void>("gh_discussion_close", { repoPath, discussionId, reason });

export const ghDiscussionReopen = (repoPath: string, discussionId: string) =>
  invoke<void>("gh_discussion_reopen", { repoPath, discussionId });

export const ghDiscussionDelete = (repoPath: string, discussionId: string) =>
  invoke<void>("gh_discussion_delete", { repoPath, discussionId });

// Issue comment + close/reopen are provider-neutral (GitHub via `gh`, GitLab via
// `glab`); the GitHub path is byte-identical to the old `gh_issue_*`. The rest of
// the issue write surface stays GitHub-only (`gh_issue_*`).
export const forgeIssueComment = (
  repoPath: string,
  number: number,
  body: string,
) => invoke<void>("forge_issue_comment", { repoPath, number, body });

export const forgeIssueClose = (
  repoPath: string,
  number: number,
  reason: string,
) => invoke<void>("forge_issue_close", { repoPath, number, reason });

export const forgeIssueReopen = (repoPath: string, number: number) =>
  invoke<void>("forge_issue_reopen", { repoPath, number });

export const ghIssueEdit = (
  repoPath: string,
  number: number,
  title: string,
  body: string,
) => invoke<void>("gh_issue_edit", { repoPath, number, title, body });

/** Transfers an issue to `destination` ("OWNER/REPO"); returns the new URL. */
export const ghIssueTransfer = (
  repoPath: string,
  number: number,
  destination: string,
) => invoke<string>("gh_issue_transfer", { repoPath, number, destination });

export const ghIssueDelete = (repoPath: string, number: number) =>
  invoke<void>("gh_issue_delete", { repoPath, number });

export const ghIssueRelations = (repoPath: string, number: number) =>
  invoke<IssueRelations>("gh_issue_relations", { repoPath, number });

export const ghIssueDependencies = (repoPath: string, number: number) =>
  invoke<IssueDependencies>("gh_issue_dependencies", { repoPath, number });

export const ghIssueDevelopment = (repoPath: string, number: number) =>
  invoke<IssueDevelopment>("gh_issue_development", { repoPath, number });

/** Creates a new branch off the default branch, linked to the issue. */
export const ghIssueCreateLinkedBranch = (
  repoPath: string,
  issueId: string,
  name: string,
) => invoke<void>("gh_issue_create_linked_branch", { repoPath, issueId, name });

/** Adds/removes a blocked-by or blocking dependency by target issue number. */
export const ghIssueSetDependency = (
  repoPath: string,
  number: number,
  relation: IssueRelation,
  target: number,
  add: boolean,
) =>
  invoke<void>("gh_issue_set_dependency", {
    repoPath,
    number,
    relation,
    target,
    add,
  });

/** Adds issue `subNumber` (this repo) as a sub-issue of `parentId` (node id). */
export const ghIssueAddSubIssue = (
  repoPath: string,
  parentId: string,
  subNumber: number,
) => invoke<void>("gh_issue_add_sub_issue", { repoPath, parentId, subNumber });

export const ghIssueRemoveSubIssue = (
  repoPath: string,
  parentId: string,
  subId: string,
) => invoke<void>("gh_issue_remove_sub_issue", { repoPath, parentId, subId });

export const ghPrDiff = (repoPath: string, number: number) =>
  invoke<string>("gh_pr_diff", { repoPath, number });

export const ghPrExternalReviews = (repoPath: string, number: number) =>
  invoke<ExternalReviewItem[]>("gh_pr_external_reviews", { repoPath, number });

export type ReviewAction = "approve" | "comment" | "request_changes";

export const ghPrReview = (
  repoPath: string,
  number: number,
  action: ReviewAction,
  body: string,
) => invoke<void>("gh_pr_review", { repoPath, number, action, body });

// MR comment + close/reopen are provider-neutral (GitHub via `gh`, GitLab via
// `glab`); the GitHub path is byte-identical to the old `gh_pr_*`. Merge / approve /
// review / edit stay GitHub-only (`gh_pr_*`).
export const forgePrComment = (
  repoPath: string,
  number: number,
  body: string,
) => invoke<void>("forge_pr_comment", { repoPath, number, body });

// MR approve/unapprove is a GitLab-only toggle (GitHub approves via the review
// flow); the read drives the control's Approve ↔ Revoke state.
export const forgePrApprovals = (repoPath: string, number: number) =>
  invoke<ApprovalState>("forge_pr_approvals", { repoPath, number });

export const forgePrApprove = (repoPath: string, number: number) =>
  invoke<void>("forge_pr_approve", { repoPath, number });

export const forgePrUnapprove = (repoPath: string, number: number) =>
  invoke<void>("forge_pr_unapprove", { repoPath, number });

export const ghPrEditComment = (
  repoPath: string,
  commentId: string,
  body: string,
) => invoke<void>("gh_pr_edit_comment", { repoPath, commentId, body });

export const ghPrDeleteComment = (repoPath: string, commentId: string) =>
  invoke<void>("gh_pr_delete_comment", { repoPath, commentId });

/** GitHub `ReportedContentClassifiers` reasons for hiding a comment. */
export type MinimizeReason =
  | "OFF_TOPIC"
  | "OUTDATED"
  | "RESOLVED"
  | "DUPLICATE"
  | "SPAM"
  | "ABUSE";

export const ghPrMinimizeComment = (
  repoPath: string,
  commentId: string,
  classifier: MinimizeReason,
) =>
  invoke<void>("gh_pr_minimize_comment", { repoPath, commentId, classifier });

export const ghPrUnminimizeComment = (repoPath: string, commentId: string) =>
  invoke<void>("gh_pr_unminimize_comment", { repoPath, commentId });

// MR merge is provider-neutral (GitHub via `gh pr merge`, GitLab via `glab`). `sha`
// is GitLab's optional stale-view guard (it 409s if the head moved since the user
// loaded the MR); GitHub has no analogue and ignores it.
export const forgePrMerge = (
  repoPath: string,
  number: number,
  strategy: MergeStrategy,
  deleteBranch: boolean,
  sha?: string,
) =>
  invoke<void>("forge_pr_merge", {
    repoPath,
    number,
    strategy,
    deleteBranch,
    sha: sha ?? null,
  });

export const forgePrClose = (repoPath: string, number: number) =>
  invoke<void>("forge_pr_close", { repoPath, number });

export const forgePrReopen = (repoPath: string, number: number) =>
  invoke<void>("forge_pr_reopen", { repoPath, number });

export const ghAccounts = () => invoke<GhAccounts>("gh_accounts");

/** Every repo the signed-in user can access (+ viewer login), newest first. */
export const ghListRepos = () => invoke<GhRepoList>("gh_list_repos");

export const ghSwitchAccount = (host: string, login: string) =>
  invoke<void>("gh_switch_account", { host, login });

export const ghPrPoll = (repoPath: string) =>
  invoke<PrPollInfo[]>("gh_pr_poll", { repoPath });

export const ghPrCheckout = (repoPath: string, number: number) =>
  invoke<void>("gh_pr_checkout", { repoPath, number });

/** Reactions for a PR's body + each comment (keyed by comment node id). */
export const ghPrReactions = (repoPath: string, number: number) =>
  invoke<IssueReactions>("gh_pr_reactions", { repoPath, number });

/** Returns the fork's URL ("" when the fork already existed). */
export const ghRepoFork = (repoPath: string, contributeToParent: boolean) =>
  invoke<string>("gh_repo_fork", { repoPath, contributeToParent });

/** Whether the signed-in user has starred this repo. */
export const ghRepoStarStatus = (repoPath: string) =>
  invoke<boolean>("gh_repo_star_status", { repoPath });

/** Stars (true) or unstars (false) this repo for the signed-in user. */
export const ghRepoSetStar = (repoPath: string, starred: boolean) =>
  invoke<void>("gh_repo_set_star", { repoPath, starred });

/** Whether the signed-in user is an admin on this repo (gates settings UI). */
export const ghRepoAdmin = (repoPath: string) =>
  invoke<boolean>("gh_repo_admin", { repoPath });

/** The active gh token's OAuth scopes (for "needs gh auth refresh -s …" hints). */
export const ghTokenScopes = (host?: string) =>
  invoke<GhScopes>("gh_token_scopes", { host: host ?? null });

export const ghHooksList = (repoPath: string) =>
  invoke<Webhook[]>("gh_hooks_list", { repoPath });

export const ghHookCreate = (repoPath: string, input: WebhookInput) =>
  invoke<Webhook>("gh_hook_create", { repoPath, input });

export const ghHookUpdate = (
  repoPath: string,
  id: number,
  input: WebhookInput,
) => invoke<Webhook>("gh_hook_update", { repoPath, id, input });

export const ghHookDelete = (repoPath: string, id: number) =>
  invoke<void>("gh_hook_delete", { repoPath, id });

export const ghHookPing = (repoPath: string, id: number) =>
  invoke<void>("gh_hook_ping", { repoPath, id });

export const ghHookTest = (repoPath: string, id: number) =>
  invoke<void>("gh_hook_test", { repoPath, id });

export const ghHookDeliveries = (repoPath: string, hookId: number) =>
  invoke<HookDelivery[]>("gh_hook_deliveries", { repoPath, hookId });

export const ghHookDelivery = (
  repoPath: string,
  hookId: number,
  deliveryId: string,
) =>
  invoke<HookDeliveryDetail>("gh_hook_delivery", {
    repoPath,
    hookId,
    deliveryId,
  });

export const ghHookRedeliver = (
  repoPath: string,
  hookId: number,
  deliveryId: string,
) => invoke<void>("gh_hook_redeliver", { repoPath, hookId, deliveryId });

export const ghRepoSettingsGet = (repoPath: string) =>
  invoke<RepoSettings>("gh_repo_settings_get", { repoPath });

export const ghRepoSettingsUpdate = (
  repoPath: string,
  input: RepoSettingsInput,
) => invoke<RepoSettings>("gh_repo_settings_update", { repoPath, input });

export const ghSecretsList = (
  repoPath: string,
  app: SecretApp,
  env: string | null,
) => invoke<GhSecret[]>("gh_secrets_list", { repoPath, app, env });

export const ghSecretSet = (
  repoPath: string,
  app: SecretApp,
  env: string | null,
  name: string,
  value: string,
) => invoke<void>("gh_secret_set", { repoPath, app, env, name, value });

export const ghSecretDelete = (
  repoPath: string,
  app: SecretApp,
  env: string | null,
  name: string,
) => invoke<void>("gh_secret_delete", { repoPath, app, env, name });

export const ghVariablesList = (repoPath: string, env: string | null) =>
  invoke<GhVariable[]>("gh_variables_list", { repoPath, env });

export const ghVariableSet = (
  repoPath: string,
  env: string | null,
  name: string,
  value: string,
) => invoke<void>("gh_variable_set", { repoPath, env, name, value });

export const ghVariableDelete = (
  repoPath: string,
  env: string | null,
  name: string,
) => invoke<void>("gh_variable_delete", { repoPath, env, name });

export const ghEnvironmentsList = (repoPath: string) =>
  invoke<string[]>("gh_environments_list", { repoPath });

export const ghCollaboratorsList = (repoPath: string) =>
  invoke<Collaborator[]>("gh_collaborators_list", { repoPath });

/** Returns true when GitHub created a pending invitation, false on an immediate grant. */
export const ghCollaboratorAdd = (
  repoPath: string,
  username: string,
  role: RepoRole,
) => invoke<boolean>("gh_collaborator_add", { repoPath, username, role });

export const ghCollaboratorRemove = (repoPath: string, username: string) =>
  invoke<void>("gh_collaborator_remove", { repoPath, username });

export const ghInvitationsList = (repoPath: string) =>
  invoke<Invitation[]>("gh_invitations_list", { repoPath });

export const ghInvitationUpdate = (
  repoPath: string,
  id: string,
  permission: RepoRole,
) => invoke<void>("gh_invitation_update", { repoPath, id, permission });

export const ghInvitationCancel = (repoPath: string, id: string) =>
  invoke<void>("gh_invitation_cancel", { repoPath, id });

export const ghSecurityGet = (repoPath: string) =>
  invoke<SecurityStatus>("gh_security_get", { repoPath });

export const ghSecurityApply = (
  repoPath: string,
  changes: { feature: SecurityFeature; enabled: boolean }[],
) => invoke<void>("gh_security_apply", { repoPath, changes });

export const ghRepoSetVisibility = (repoPath: string, visibility: string) =>
  invoke<void>("gh_repo_set_visibility", { repoPath, visibility });

export const ghRepoTransfer = (
  repoPath: string,
  newOwner: string,
  newName: string | null,
) => invoke<void>("gh_repo_transfer", { repoPath, newOwner, newName });

export const ghRepoDelete = (repoPath: string) =>
  invoke<void>("gh_repo_delete", { repoPath });

export const ghRepoSetArchived = (repoPath: string, archived: boolean) =>
  invoke<void>("gh_repo_set_archived", { repoPath, archived });

export const ghRepoRename = (repoPath: string, newName: string) =>
  invoke<void>("gh_repo_rename", { repoPath, newName });

export const ghPagesGet = (repoPath: string) =>
  invoke<PagesInfo | null>("gh_pages_get", { repoPath });

export const ghPagesEnable = (
  repoPath: string,
  buildType: string,
  branch: string | null,
  path: string | null,
) => invoke<void>("gh_pages_enable", { repoPath, buildType, branch, path });

export const ghPagesUpdate = (
  repoPath: string,
  args: {
    buildType?: string;
    branch?: string;
    path?: string;
    cname?: string;
    httpsEnforced?: boolean;
  },
) =>
  invoke<void>("gh_pages_update", {
    repoPath,
    buildType: args.buildType ?? null,
    branch: args.branch ?? null,
    path: args.path ?? null,
    cname: args.cname ?? null,
    httpsEnforced: args.httpsEnforced ?? null,
  });

export const ghPagesDisable = (repoPath: string) =>
  invoke<void>("gh_pages_disable", { repoPath });

export const ghRulesetsList = (repoPath: string) =>
  invoke<RulesetSummary[]>("gh_rulesets_list", { repoPath });

export const ghRulesetGet = (repoPath: string, id: number) =>
  invoke<RulesetFull>("gh_ruleset_get", { repoPath, id });

export const ghRulesetCreate = (
  repoPath: string,
  body: Record<string, unknown>,
) => invoke<void>("gh_ruleset_create", { repoPath, body });

export const ghRulesetUpdate = (
  repoPath: string,
  id: number,
  body: Record<string, unknown>,
) => invoke<void>("gh_ruleset_update", { repoPath, id, body });

export const ghRulesetDelete = (repoPath: string, id: number) =>
  invoke<void>("gh_ruleset_delete", { repoPath, id });

export const ghRulesetSetEnforcement = (
  repoPath: string,
  id: number,
  enforcement: RulesetEnforcement,
) => invoke<void>("gh_ruleset_set_enforcement", { repoPath, id, enforcement });

/** The repo's local `.github/dependabot.yml` text (null when absent). */
export const dependabotGet = (repoPath: string) =>
  invoke<string | null>("dependabot_get", { repoPath });

export const dependabotSet = (repoPath: string, content: string) =>
  invoke<void>("dependabot_set", { repoPath, content });

export const dependabotDelete = (repoPath: string) =>
  invoke<void>("dependabot_delete", { repoPath });

/** The repo's local `.github/FUNDING.yml` text (null when absent). */
export const fundingGet = (repoPath: string) =>
  invoke<string | null>("funding_get", { repoPath });

export const fundingSet = (repoPath: string, content: string) =>
  invoke<void>("funding_set", { repoPath, content });

export const fundingDelete = (repoPath: string) =>
  invoke<void>("funding_delete", { repoPath });

export const ghPrReady = (repoPath: string, number: number) =>
  invoke<void>("gh_pr_ready", { repoPath, number });

export const ghPrEdit = (
  repoPath: string,
  number: number,
  title: string,
  body: string,
) => invoke<void>("gh_pr_edit", { repoPath, number, title, body });

export const forgeRepoLabels = (repoPath: string) =>
  invoke<RepoLabel[]>("forge_repo_labels", { repoPath });

/** GitHub's (classic) branch protection rules — read-only, for importing. */
export const ghBranchProtections = (repoPath: string) =>
  invoke<GhBranchProtection[]>("gh_branch_protections", { repoPath });

export const gitHooksList = (repoPath: string) =>
  invoke<HooksInfo>("git_hooks_list", { repoPath });

export const gitHookRead = (repoPath: string, name: string) =>
  invoke<string | null>("git_hook_read", { repoPath, name });

export const gitHookWrite = (repoPath: string, name: string, content: string) =>
  invoke<void>("git_hook_write", { repoPath, name, content });

export const gitHookSetEnabled = (
  repoPath: string,
  name: string,
  enabled: boolean,
) => invoke<void>("git_hook_set_enabled", { repoPath, name, enabled });

export const gitHookDelete = (repoPath: string, name: string) =>
  invoke<void>("git_hook_delete", { repoPath, name });

/** Runs a hook manager's CLI (pre-commit/lefthook); returns its output. */
export const gitRunHookManager = (
  repoPath: string,
  manager: string,
  action: "install" | "update",
) => invoke<string>("git_run_hook_manager", { repoPath, manager, action });

/** Add/remove labels on an issue or MR. GitHub keys them by GraphQL node id
 *  (`addIds`/`removeIds` on `labelableId`); GitLab keys them by name
 *  (`addNames`/`removeNames` on `number`). Callers pass both; the forge command
 *  takes whichever pair the repo's provider addresses by. `target` is "issue"|"mr". */
export const forgeEditLabels = (
  repoPath: string,
  target: "issue" | "mr",
  number: number,
  labelableId: string,
  addIds: string[],
  removeIds: string[],
  addNames: string[],
  removeNames: string[],
) =>
  invoke<void>("forge_edit_labels", {
    repoPath,
    target,
    number,
    labelableId,
    addIds,
    removeIds,
    addNames,
    removeNames,
  });

export const openWithProgram = (program: string, path: string) =>
  invoke<void>("open_with_program", { program, path });

export interface DetectedEditor {
  name: string;
  path: string;
}

export const detectEditors = () => invoke<DetectedEditor[]>("detect_editors");

export interface DetectedTerminal {
  /** Known kind id the launcher dispatches on, e.g. "powershell". */
  id: string;
  name: string;
  path: string;
}

export const detectTerminals = () =>
  invoke<DetectedTerminal[]>("detect_terminals");

export const readRepoInstructions = (repoPath: string) =>
  invoke<string | null>("read_repo_instructions", { repoPath });

export const readRepoAiIgnore = (repoPath: string) =>
  invoke<string[]>("read_repo_ai_ignore", { repoPath });

/** Raw contents of `<repo>/.gitdesktop/branch-rules.json`, or null if absent. */
export const readRepoBranchRules = (repoPath: string) =>
  invoke<string | null>("read_repo_branch_rules", { repoPath });

/** Writes `<repo>/.gitdesktop/branch-rules.json` (caller passes serialized JSON). */
export const writeRepoBranchRules = (repoPath: string, contents: string) =>
  invoke<void>("write_repo_branch_rules", { repoPath, contents });

/** Raw contents of `<repo>/.gitdesktop/syntax.json`, or null if absent. */
export const readRepoSyntax = (repoPath: string) =>
  invoke<string | null>("read_repo_syntax", { repoPath });

/** Writes `<repo>/.gitdesktop/syntax.json` (caller passes serialized JSON). */
export const writeRepoSyntax = (repoPath: string, contents: string) =>
  invoke<void>("write_repo_syntax", { repoPath, contents });

/** A slash-command or skill discovered for an agent (project or global). */
export interface AgentCommand {
  name: string;
  description: string;
  /** Command body (`$ARGUMENTS`/`$1..` expanded on use); empty for skills. */
  prompt: string;
  argumentHint: string;
  kind: "command" | "skill";
  scope: "project" | "global";
}

/** Slash-commands + skills available to `agent`, from the repo and the user's
 *  home, following each CLI's conventions + the canonical `.agents/skills`. */
export const readAgentCommands = (repoPath: string, agent: string) =>
  invoke<AgentCommand[]>("read_agent_commands", { repoPath, agent });

/** Reads a small text file the user picked (for importing a language config). */
export const readTextFile = (path: string) =>
  invoke<string>("read_text_file", { path });

/** Absolute path to the running app executable — the command for the "use
 *  GitDesktop as an MCP server" config snippet (`<exe> mcp --repo <path>`). */
export const appExePath = () => invoke<string>("app_exe_path");

// Cold-start test mode keeps API keys in an isolated sessionStorage store so
// the OS keychain (and the user's real keys) are never touched (no-op normally).
export const setSecret = (provider: string, value: string) =>
  COLD_START
    ? Promise.resolve(coldStartSetSecret(provider, value))
    : invoke<void>("set_secret", { provider, value });

export const getSecret = (provider: string) =>
  COLD_START
    ? Promise.resolve(coldStartGetSecret(provider))
    : invoke<string | null>("get_secret", { provider });

export const deleteSecret = (provider: string) =>
  COLD_START
    ? Promise.resolve(coldStartDeleteSecret(provider))
    : invoke<void>("delete_secret", { provider });

export const secretExists = (provider: string) =>
  COLD_START
    ? Promise.resolve(coldStartGetSecret(provider) !== null)
    : invoke<boolean>("secret_exists", { provider });

// MCP server secrets are keyed per registered server id + entry (env/header)
// name; in cold-start mode they reuse the isolated store via a combined key.
const mcpRef = (serverId: string, key: string) =>
  `mcp-server/${serverId}/${key}`;

export const setMcpSecret = (serverId: string, key: string, value: string) =>
  COLD_START
    ? Promise.resolve(coldStartSetSecret(mcpRef(serverId, key), value))
    : invoke<void>("set_mcp_secret", { serverId, key, value });

export const deleteMcpSecret = (serverId: string, key: string) =>
  COLD_START
    ? Promise.resolve(coldStartDeleteSecret(mcpRef(serverId, key)))
    : invoke<void>("delete_mcp_secret", { serverId, key });

export const mcpSecretExists = (serverId: string, key: string) =>
  COLD_START
    ? Promise.resolve(coldStartGetSecret(mcpRef(serverId, key)) !== null)
    : invoke<boolean>("mcp_secret_exists", { serverId, key });
