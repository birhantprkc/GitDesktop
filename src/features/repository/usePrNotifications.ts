import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { ghPrPoll } from "@/lib/git/api";
import { useGhStatus } from "@/lib/git/queries";
import type { PrPollInfo } from "@/lib/git/types";
import { notifyIfUnfocused } from "@/lib/notify";
import { useSettings } from "@/lib/settings/queries";

/**
 * Background PR poller for OS notifications: roughly once a minute (also
 * while the window is unfocused — that's the point), it snapshots the
 * repo's recently-updated PRs and notifies on transitions the user opted
 * into — check rollups finishing, PRs opened/merged/closed, and review
 * decisions on their own PRs. The first poll after opening a repo only
 * primes the snapshot.
 */
export function usePrNotifications(repoPath: string) {
  const settings = useSettings();
  const gh = useGhStatus(repoPath);
  const prefs = settings.data?.notifications;
  const anyEnabled = Boolean(
    prefs && (prefs.prChecks !== "off" || prefs.prActivity || prefs.prReviews),
  );
  const enabled = repoPath !== "" && Boolean(gh.data?.repo) && anyEnabled;

  const poll = useQuery({
    queryKey: ["repo", repoPath, "pr-poll"] as const,
    queryFn: () => ghPrPoll(repoPath),
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 55_000,
    retry: false,
  });

  const prev = useRef<Map<number, PrPollInfo> | null>(null);
  const prevRepo = useRef(repoPath);
  if (prevRepo.current !== repoPath) {
    prevRepo.current = repoPath;
    prev.current = null;
  }

  // Effect event: reads the latest prefs/login without re-running the diff
  // when they change.
  const diff = useEffectEvent((data: PrPollInfo[]) => {
    const snapshot = new Map(data.map((p) => [p.number, p]));
    const before = prev.current;
    prev.current = snapshot;
    if (!before || !prefs) return;
    const login = gh.data?.login ?? null;

    for (const pr of snapshot.values()) {
      const old = before.get(pr.number);
      const mine = login !== null && pr.author === login;

      if (
        prefs.prChecks !== "off" &&
        (prefs.prChecks === "all" || mine) &&
        old &&
        pr.state === "OPEN" &&
        old.checksState !== pr.checksState &&
        (pr.checksState === "SUCCESS" || pr.checksState === "FAILURE")
      ) {
        void notifyIfUnfocused(
          pr.checksState === "SUCCESS"
            ? `Checks passed on #${pr.number}`
            : `Checks failed on #${pr.number}`,
          pr.title,
        );
      }

      if (prefs.prActivity) {
        if (!old && pr.state === "OPEN" && !mine && !pr.isDraft) {
          void notifyIfUnfocused(
            `New pull request #${pr.number} by ${pr.author}`,
            pr.title,
          );
        }
        if (old && old.state === "OPEN" && pr.state !== "OPEN") {
          void notifyIfUnfocused(
            `#${pr.number} was ${pr.state === "MERGED" ? "merged" : "closed"}`,
            pr.title,
          );
        }
      }

      if (
        prefs.prReviews &&
        mine &&
        old &&
        old.reviewDecision !== pr.reviewDecision &&
        (pr.reviewDecision === "APPROVED" ||
          pr.reviewDecision === "CHANGES_REQUESTED")
      ) {
        void notifyIfUnfocused(
          pr.reviewDecision === "APPROVED"
            ? `#${pr.number} was approved`
            : `Changes requested on #${pr.number}`,
          pr.title,
        );
      }
    }
  });

  useEffect(() => {
    if (poll.data) diff(poll.data);
  }, [poll.data]);
}
