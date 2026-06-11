import { useCallback } from "react";
import { gitCommitDetails } from "@/lib/git/api";
import { useUiStore } from "@/lib/stores/ui";

/**
 * Loads a commit's message into the commit box and switches to the Changes
 * tab in amend mode. Shared by the history context menu and the commit
 * detail actions menu. Throws on lookup failure; callers surface the error.
 */
export function useAmendCommit(repoPath: string) {
  const setCommitDraft = useUiStore((s) => s.setCommitDraft);
  const setAmending = useUiStore((s) => s.setAmending);
  const setRepoTab = useUiStore((s) => s.setRepoTab);

  return useCallback(
    async (hash: string) => {
      const details = await gitCommitDetails(repoPath, hash);
      setCommitDraft(details.subject, details.body);
      setAmending(hash);
      setRepoTab("changes");
    },
    [repoPath, setCommitDraft, setAmending, setRepoTab],
  );
}
