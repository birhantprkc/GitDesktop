import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { gitBranchesMerged } from "@/lib/git/api";
import { useLocalPrs, useSaveLocalPr } from "@/lib/pulls/queries";

/**
 * Keeps open local PRs honest with git: if a PR's head has been fully merged
 * into its base outside the app (the branch picker, the CLI, a fast-forward),
 * mark it merged so it leaves the Open list. Mount where local PRs are shown.
 */
export function useReconcileLocalPrs(repo: string) {
  const prs = useLocalPrs(repo);
  const { mutate } = useSaveLocalPr(repo);
  const open = (prs.data ?? []).filter((p) => p.status === "open");

  const merged = useQuery({
    queryKey: [
      "local-prs-merged",
      repo,
      open.map((p) => `${p.id}:${p.base}:${p.head}`),
    ] as const,
    queryFn: () =>
      gitBranchesMerged(
        repo,
        open.map((p) => ({ base: p.base, head: p.head })),
      ),
    enabled: open.length > 0,
  });

  // Guard against re-marking the same PR before the list refetch lands.
  const done = useRef<Set<string>>(new Set());
  useEffect(() => {
    const flags = merged.data;
    if (!flags) return;
    open.forEach((pr, i) => {
      if (flags[i] && !done.current.has(pr.id)) {
        done.current.add(pr.id);
        mutate({
          ...pr,
          status: "merged",
          mergedAt: pr.mergedAt ?? new Date().toISOString(),
        });
      }
    });
  }, [merged.data, open, mutate]);
}
