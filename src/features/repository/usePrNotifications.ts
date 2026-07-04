import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import { useAutomations } from "@/lib/automations/queries";
import { maybeFireSync } from "@/lib/automations/sync";
import { effectiveRules } from "@/lib/automations/types";
import { forgePrPoll } from "@/lib/git/api";
import { forgeFeatureReady, useForgeStatus } from "@/lib/git/queries";
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
  const gh = useForgeStatus(repoPath);
  const automations = useAutomations();
  const prefs = settings.data?.notifications;
  const anyNotif = Boolean(
    prefs && (prefs.prChecks !== "off" || prefs.prActivity || prefs.prReviews),
  );
  // A pr-sync rule needs this head-OID poll to spot new commits on remote PRs;
  // otherwise the poll only earns its keep when a PR notification is enabled, so
  // the default (no notifications, no pr-sync rule) makes no background call.
  const hasPrSync = automations.data
    ? effectiveRules(automations.data, repoPath, "pr-sync").length > 0
    : false;
  // The head-OID poll (and pr-sync) run through the provider-neutral `forge_pr_poll`,
  // so the poller works for any ready hosted repo (GitHub/GitLab/Bitbucket). For
  // GitLab/Bitbucket the check-rollup and review-decision fields come back empty, so
  // those notification branches simply never fire there (a documented v1 limit) —
  // opened/merged/closed activity and remote pr-sync work on all three.
  const enabled =
    repoPath !== "" &&
    forgeFeatureReady(gh.data, "pullRequests") &&
    (anyNotif || hasPrSync);

  const poll = useQuery({
    queryKey: ["repo", repoPath, "pr-poll"] as const,
    queryFn: () => forgePrPoll(repoPath),
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

    // pr-sync: auto re-review open remote PRs whose head advanced — the path
    // that covers PRs whose head branch isn't local (forks / pushed elsewhere).
    // Only when a pr-sync rule exists (so no fan-out for notification-only
    // users); deduped by head in `maybeFireSync`, and the runner gates whether
    // to actually review (opt-in per PR + per-mode watermark). Body/commit
    // subjects aren't in the poll payload — the PR diff is the source of truth.
    if (hasPrSync) {
      for (const pr of snapshot.values()) {
        if (pr.state === "OPEN" && pr.headSha) {
          maybeFireSync({
            repoPath,
            kind: "remote",
            ref: String(pr.number),
            currentHeadSha: pr.headSha,
            base: "",
            head: "",
            title: pr.title,
            body: "",
            commitSubjects: [],
          });
        }
      }
    }

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
