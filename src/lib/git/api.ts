import { invoke } from "@/lib/tauri/invoke";
import type {
  Branch,
  CommitDetails,
  CommitResult,
  CommitSummary,
  DiffStatEntry,
  FileDiff,
  GitInfo,
  RepoInfo,
  RepoStatus,
  StagedDiff,
} from "./types";

export const checkGitInstalled = () => invoke<GitInfo>("check_git_installed");

export const validateRepo = (path: string) =>
  invoke<RepoInfo>("validate_repo", { path });

export const cloneRepo = (url: string, parentDir: string, dirName?: string) =>
  invoke<string>("clone_repo", { url, parentDir, dirName: dirName ?? null });

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
) => invoke<void>("git_create_branch", { repoPath, name, checkout });

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

export const gitCommit = (repoPath: string, title: string, body?: string) =>
  invoke<CommitResult>("git_commit", { repoPath, title, body: body ?? null });

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

export const gitPush = (repoPath: string, setUpstream: boolean) =>
  invoke<void>("git_push", { repoPath, setUpstream });

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
