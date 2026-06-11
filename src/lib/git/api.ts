import { invoke } from "@/lib/tauri/invoke";
import type {
  Branch,
  BranchComparison,
  CommitDetails,
  CommitResult,
  CommitSummary,
  DiffStatEntry,
  FileDiff,
  GhStatus,
  GitInfo,
  PrDetails,
  PrInfo,
  PrRef,
  RepoInfo,
  RepoStatus,
  StagedDiff,
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

export const gitStagedDiff = (
  repoPath: string,
  maxBytes?: number,
  exclude?: string[],
) =>
  invoke<StagedDiff>("git_staged_diff", {
    repoPath,
    maxBytes: maxBytes ?? null,
    exclude: exclude ?? null,
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

export const gitDiscard = (
  repoPath: string,
  path: string,
  untracked: boolean,
) => invoke<void>("git_discard", { repoPath, path, untracked });

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

export const appendToGitignore = (repoPath: string, pattern: string) =>
  invoke<void>("append_to_gitignore", { repoPath, pattern });

export const revealInExplorer = (path: string) =>
  invoke<void>("reveal_in_explorer", { path });

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

export const gitLog = (repoPath: string, limit: number, skip: number) =>
  invoke<CommitSummary[]>("git_log", { repoPath, limit, skip });

export const gitCommitDetails = (repoPath: string, hash: string) =>
  invoke<CommitDetails>("git_commit_details", { repoPath, hash });

export const gitCommitFiles = (repoPath: string, hash: string) =>
  invoke<DiffStatEntry[]>("git_commit_files", { repoPath, hash });

export const gitCommitFileDiff = (
  repoPath: string,
  hash: string,
  filePath: string,
) => invoke<FileDiff>("git_commit_file_diff", { repoPath, hash, filePath });

export const gitFetch = (repoPath: string) =>
  invoke<void>("git_fetch", { repoPath });

export const gitPull = (repoPath: string) =>
  invoke<void>("git_pull", { repoPath });

export const gitPush = (
  repoPath: string,
  setUpstream: boolean,
  force = false,
) => invoke<void>("git_push", { repoPath, setUpstream, force });

export const gitRemotes = (repoPath: string) =>
  invoke<string[]>("git_remotes", { repoPath });

export const gitUndoCommit = (repoPath: string) =>
  invoke<void>("git_undo_commit", { repoPath });

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

export const gitStashAll = (repoPath: string) =>
  invoke<void>("git_stash_all", { repoPath });

export const gitStashPop = (repoPath: string) =>
  invoke<void>("git_stash_pop", { repoPath });

export const gitStashCount = (repoPath: string) =>
  invoke<number>("git_stash_count", { repoPath });

export const gitMerge = (repoPath: string, branch: string, squash: boolean) =>
  invoke<void>("git_merge", { repoPath, branch, squash });

export const gitRebase = (repoPath: string, branch: string) =>
  invoke<void>("git_rebase", { repoPath, branch });

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

export const ghStatus = (repoPath: string) =>
  invoke<GhStatus>("gh_status", { repoPath });

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
) =>
  invoke<string>("gh_publish_repo", {
    repoPath,
    name,
    private: isPrivate,
    description,
  });

export const ghPrsForBranch = (repoPath: string, head: string) =>
  invoke<PrInfo[]>("gh_prs_for_branch", { repoPath, head });

export const ghPrList = (repoPath: string) =>
  invoke<PrInfo[]>("gh_pr_list", { repoPath });

export const ghPrView = (repoPath: string, number: number) =>
  invoke<PrDetails>("gh_pr_view", { repoPath, number });

export const ghPrDiff = (repoPath: string, number: number) =>
  invoke<string>("gh_pr_diff", { repoPath, number });

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

export const setSecret = (provider: string, value: string) =>
  invoke<void>("set_secret", { provider, value });

export const getSecret = (provider: string) =>
  invoke<string | null>("get_secret", { provider });

export const deleteSecret = (provider: string) =>
  invoke<void>("delete_secret", { provider });

export const secretExists = (provider: string) =>
  invoke<boolean>("secret_exists", { provider });
