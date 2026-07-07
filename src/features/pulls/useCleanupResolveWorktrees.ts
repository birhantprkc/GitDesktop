import { useEffect, useRef } from "react";
import { gitCleanupOrphanedResolveWorktrees } from "@/lib/git/api";
import { useLocalPrs } from "@/lib/pulls/queries";

/**
 * Reclaims leaked local-PR conflict-resolution worktrees on repo open — a crash
 * mid-resolve can leave a hidden `gd-resolve-*` worktree behind. Sweeps ONCE per
 * repo (tracked in `sweptRepo`), and only AFTER the local-PR list has loaded:
 * the keep-set is every active paused merge's `pendingMerge.worktreePath`, so
 * gating strictly on `prs.isSuccess` is load-bearing — running before the list
 * loads would pass an empty keep-set and delete a genuinely-active resolve
 * worktree. Best-effort housekeeping: errors are swallowed. Mount once per repo.
 */
export function useCleanupResolveWorktrees(repoPath: string) {
  const prs = useLocalPrs(repoPath);
  const sweptRepo = useRef<string | null>(null);

  useEffect(() => {
    // `repoPath` is "" when no repo is open (RepositoryView passes `?? ""`);
    // never sweep in that case.
    if (!repoPath || !prs.isSuccess || sweptRepo.current === repoPath) return;
    sweptRepo.current = repoPath;
    const keep = (prs.data ?? [])
      .map((p) => p.pendingMerge?.worktreePath)
      .filter((p): p is string => Boolean(p));
    gitCleanupOrphanedResolveWorktrees(repoPath, keep).catch(() => undefined);
  }, [repoPath, prs.isSuccess, prs.data]);
}
