import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useOpAbort, useOpContinue, useOpState } from "@/lib/git/queries";
import type { RepoOp } from "@/lib/git/types";
import { toastError } from "@/lib/toast";

const OP_LABELS: Record<RepoOp, { banner: string; cont: string }> = {
  merge: { banner: "Merge in progress", cont: "Finish merge" },
  rebase: { banner: "Rebase in progress", cont: "Continue rebase" },
  "cherry-pick": {
    banner: "Cherry-pick in progress",
    cont: "Continue cherry-pick",
  },
};

/**
 * Guides an in-progress merge/rebase/cherry-pick to its end: shows what's
 * mid-flight and how many conflicts remain, with Continue gated on every
 * conflict being resolved (staged) and Abort behind a confirm. Renders
 * nothing when the repo is in a normal state.
 */
export function ConflictBanner({
  repoPath,
  conflictedCount,
}: {
  repoPath: string;
  conflictedCount: number;
}) {
  const opState = useOpState(repoPath);
  const abortOp = useOpAbort(repoPath);
  const continueOp = useOpContinue(repoPath);
  const [confirmAbort, setConfirmAbort] = useState(false);

  const op: RepoOp | null = opState.data?.merging
    ? "merge"
    : opState.data?.rebasing
      ? "rebase"
      : opState.data?.cherryPicking
        ? "cherry-pick"
        : null;
  if (!op && conflictedCount === 0) return null;

  const busy = abortOp.isPending || continueOp.isPending;
  const onError = (e: unknown) => toastError(e);
  const conflictNote =
    conflictedCount > 0
      ? `${conflictedCount} conflicted file${conflictedCount === 1 ? "" : "s"} — edit to resolve, then stage to mark resolved.`
      : "All conflicts resolved.";

  return (
    <div className="space-y-2 border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      <div>
        <p className="font-medium">
          {op ? OP_LABELS[op].banner : "Conflicts to resolve"}
        </p>
        <p>{conflictNote}</p>
      </div>
      {op && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => setConfirmAbort(true)}
          >
            Abort
          </Button>
          <Button
            size="xs"
            disabled={busy || conflictedCount > 0}
            title={
              conflictedCount > 0
                ? "Resolve and stage every conflicted file first"
                : undefined
            }
            onClick={() =>
              continueOp.mutate(op, {
                onSuccess: () =>
                  toast.success(
                    op === "merge"
                      ? "Merge completed"
                      : `${OP_LABELS[op].banner.replace(" in progress", "")} continued`,
                  ),
                onError,
              })
            }
          >
            {continueOp.isPending && <Spinner data-icon="inline-start" />}
            {OP_LABELS[op].cont}
          </Button>

          <Dialog open={confirmAbort} onOpenChange={setConfirmAbort}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Abort the {op}?</DialogTitle>
                <DialogDescription>
                  Abandons the in-progress {op} and restores the repository to
                  the state before it started. Any conflict resolutions you've
                  made will be lost.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmAbort(false)}
                >
                  Keep going
                </Button>
                <Button
                  variant="destructive"
                  disabled={abortOp.isPending}
                  onClick={() =>
                    abortOp.mutate(op, {
                      onSuccess: () => {
                        setConfirmAbort(false);
                        toast.success(`Aborted the ${op}`);
                      },
                      onError: (e) => {
                        setConfirmAbort(false);
                        onError(e);
                      },
                    })
                  }
                >
                  {abortOp.isPending && <Spinner data-icon="inline-start" />}
                  Abort {op}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
