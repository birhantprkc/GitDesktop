import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { maybeFireSync } from "@/lib/automations/sync";
import { gitBranchTips } from "@/lib/git/api";
import { useGhStatus, usePrList } from "@/lib/git/queries";
import { useLocalPrs } from "@/lib/pulls/queries";

/**
 * Watches each OPEN PR's head branch for new commits and fires a `pr-sync`
 * automation event when a head advances. Covers BOTH local PRs and remote
 * GitHub PRs whose head branch exists locally (i.e. your own PRs — the iterate
 * case), by polling the local branch tips in one `git_branch_tips` call. This
 * is more responsive than a GitHub poll (it fires the moment you commit, before
 * pushing) and needs no remote round-trip; PRs whose head branch isn't local
 * (forks / others') are simply not watched. `maybeFireSync` debounces by head,
 * and the runner gates whether to actually re-review (opt-in per PR + per-mode
 * watermark). Mount once per open repo.
 */
export function useWatchPrHeads(repoPath: string) {
  const local = useLocalPrs(repoPath);
  const gh = useGhStatus(repoPath);
  const canGh = Boolean(gh.data?.repo);
  const remote = usePrList(repoPath, canGh, "open");

  const openLocal = useMemo(
    () => (local.data ?? []).filter((p) => p.status === "open"),
    [local.data],
  );
  const openRemote = useMemo(
    () => (canGh ? (remote.data ?? []) : []).filter((p) => p.state === "OPEN"),
    [canGh, remote.data],
  );

  const headBranches = useMemo(() => {
    const branches = new Set<string>();
    for (const p of openLocal) branches.add(p.head);
    for (const p of openRemote) branches.add(p.headRefName);
    return [...branches].sort();
  }, [openLocal, openRemote]);

  const tips = useQuery({
    queryKey: ["branch-tips", repoPath, headBranches],
    queryFn: () => gitBranchTips(repoPath, headBranches),
    enabled: Boolean(repoPath) && headBranches.length > 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const data = tips.data;
    if (!data) return;
    for (const pr of openLocal) {
      const head = data[pr.head];
      if (!head) continue;
      maybeFireSync({
        repoPath,
        kind: "local",
        ref: pr.id,
        currentHeadSha: head,
        base: pr.base,
        head: pr.head,
        title: pr.title,
        body: pr.body,
        commitSubjects: [],
      });
    }
    for (const pr of openRemote) {
      const head = data[pr.headRefName];
      if (!head) continue;
      maybeFireSync({
        repoPath,
        kind: "remote",
        ref: String(pr.number),
        currentHeadSha: head,
        base: pr.baseRefName,
        head: pr.headRefName,
        title: pr.title,
        body: "",
        commitSubjects: [],
      });
    }
  }, [tips.data, openLocal, openRemote, repoPath]);
}
