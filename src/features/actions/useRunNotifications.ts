import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { useForgeStatus, useRepoStatus } from "@/lib/git/queries";
import { ghRunList, isRunActive, type WorkflowRun } from "@/lib/github/actions";
import { notifyIfUnfocused } from "@/lib/notify";
import { useSettings } from "@/lib/settings/queries";
import { isFailureConclusion, statusLabel } from "./status";

/**
 * Background poller for OS notifications on the current branch's workflow runs:
 * roughly every 45s (also while unfocused) it snapshots recent runs and
 * notifies when one transitions from active to completed. The first poll after
 * opening a repo (or switching branch) only primes the snapshot.
 */
export function useRunNotifications(repoPath: string) {
  const settings = useSettings();
  const gh = useForgeStatus(repoPath);
  const status = useRepoStatus(repoPath);
  const branch = status.data?.branch.name ?? null;
  // Workflow runs are a GitHub-Actions-only poll; GitLab CI notifications arrive
  // with the CI read increment.
  const enabled =
    repoPath !== "" &&
    gh.data?.provider === "github" &&
    Boolean(gh.data?.repo) &&
    Boolean(branch) &&
    Boolean(settings.data?.notifications.actionRuns);

  const poll = useQuery({
    queryKey: ["repo", repoPath, "actions", "notify", branch ?? ""] as const,
    queryFn: () => ghRunList(repoPath, 20, branch ?? undefined),
    enabled,
    refetchInterval: 45_000,
    refetchIntervalInBackground: true,
    staleTime: 40_000,
    retry: false,
  });

  // Reset the snapshot when the repo or branch changes, so we don't fire a
  // backlog of "finished" notifications after a context switch.
  const prev = useRef<Map<number, WorkflowRun> | null>(null);
  const prevKey = useRef(`${repoPath}:${branch}`);
  if (prevKey.current !== `${repoPath}:${branch}`) {
    prevKey.current = `${repoPath}:${branch}`;
    prev.current = null;
  }

  const diff = useEffectEvent((runs: WorkflowRun[]) => {
    const snapshot = new Map(runs.map((r) => [r.id, r]));
    const before = prev.current;
    prev.current = snapshot;
    if (!before) return;

    for (const run of snapshot.values()) {
      const old = before.get(run.id);
      // Notify only on the active → completed edge we actually witnessed.
      if (old && isRunActive(old.status) && run.status === "completed") {
        const ok = run.conclusion === "success";
        const bad = isFailureConclusion(run.conclusion);
        if (!ok && !bad) continue; // skipped/cancelled/neutral: stay quiet
        void notifyIfUnfocused(
          `${run.workflowName} ${statusLabel(run.status, run.conclusion).toLowerCase()} on ${run.headBranch}`,
          run.displayTitle,
        );
      }
    }
  });

  useEffect(() => {
    if (poll.data) diff(poll.data);
  }, [poll.data]);
}
