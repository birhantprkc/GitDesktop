import { invoke } from "@/lib/tauri/invoke";

/** A git worktree: an isolated branch checkout (used for agent sessions). */
export interface WorktreeInfo {
  /** Short session id (also the worktree directory name). */
  id: string;
  /** Absolute path to the worktree checkout. */
  path: string;
  /** The session branch (`gd/session/<id>`), or "" if detached. */
  branch: string;
  /** The commit the worktree was created from — base for the cumulative
   *  `base..HEAD` session diff. Resolved by create; "" from list. */
  base: string;
}

/** Creates a throwaway worktree off `baseRef` (default HEAD) on a fresh
 *  `gd/session/<id>` branch, for an agent session to run inside. */
export const createWorktree = (repoPath: string, baseRef?: string) =>
  invoke<WorktreeInfo>("git_worktree_create", {
    repoPath,
    baseRef: baseRef ?? null,
  });

/** Lists the repo's worktrees (for discovering orphans to clean up). */
export const listWorktrees = (repoPath: string) =>
  invoke<WorktreeInfo[]>("git_worktree_list", { repoPath });

/** Removes a session worktree and (when given) deletes its branch. `force` is
 *  required to drop a worktree with uncommitted changes. */
export const removeWorktree = (
  repoPath: string,
  path: string,
  branch: string | null,
  force: boolean,
) => invoke<void>("git_worktree_remove", { repoPath, path, branch, force });

/** Prunes stale worktree admin entries (e.g. after a crash). */
export const pruneWorktrees = (repoPath: string) =>
  invoke<void>("git_worktree_prune", { repoPath });

/** Re-creates a kept session's worktree, checking out its EXISTING branch at
 *  `path` so the user can resume work (the branch already holds the kept work). */
export const resumeWorktree = (
  repoPath: string,
  path: string,
  branch: string,
) => invoke<void>("git_worktree_resume", { repoPath, path, branch });

/** Stages everything (incl. untracked) in a worktree and commits it. Returns
 *  the new commit hash, or null when the agent changed nothing. Used to commit
 *  each agent turn as a checkpoint. */
export const commitWorktreeAll = (worktreePath: string, message: string) =>
  invoke<string | null>("git_worktree_commit_all", { worktreePath, message });

/** Collapses a session branch's per-turn commits since `base` into one commit.
 *  Returns false when HEAD is already at base. Used by Keep when squashing. */
export const squashWorktree = (
  worktreePath: string,
  base: string,
  message: string,
) => invoke<boolean>("git_worktree_squash", { worktreePath, base, message });
