import {
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  ArrowUpIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  useFetchRemote,
  usePull,
  usePush,
  useRepoStatus,
} from "@/lib/git/queries";
import { errorMessage } from "@/lib/tauri/invoke";

export function SyncControls({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const fetchRemote = useFetchRemote(repoPath);
  const pull = usePull(repoPath);
  const push = usePush(repoPath);
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);

  const head = status.data?.branch;
  const hasUpstream = Boolean(head?.upstream);
  // amended/rewritten local history: local and remote both have commits the
  // other lacks, so neither pull --ff-only nor a normal push can succeed
  const diverged = Boolean(head && head.ahead > 0 && head.behind > 0);
  const busy = fetchRemote.isPending || pull.isPending || push.isPending;
  const onError = (e: unknown) => toast.error(errorMessage(e));

  function doPush(force: boolean) {
    push.mutate(
      { setUpstream: !hasUpstream, force },
      {
        onSuccess: () => {
          if (force) toast.success("Force pushed");
          setForceConfirmOpen(false);
        },
        onError: (e) => {
          onError(e);
          setForceConfirmOpen(false);
        },
      },
    );
  }

  return (
    <div className="flex items-center gap-2">
      {head && head.ahead > 0 && (
        <Badge variant="secondary">
          <ArrowUpIcon className="size-3" />
          {head.ahead}
        </Badge>
      )}
      {head && head.behind > 0 && (
        <Badge variant="secondary">
          <ArrowDownIcon className="size-3" />
          {head.behind}
        </Badge>
      )}
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fetchRemote.mutate(undefined, { onError })}
        >
          {fetchRemote.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowsClockwiseIcon data-icon="inline-start" />
          )}
          Fetch
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !hasUpstream || diverged}
          onClick={() => pull.mutate(undefined, { onError })}
        >
          {pull.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowDownIcon data-icon="inline-start" />
          )}
          Pull
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (diverged) {
              setForceConfirmOpen(true);
            } else {
              doPush(false);
            }
          }}
        >
          {push.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : diverged ? (
            <WarningIcon data-icon="inline-start" />
          ) : (
            <ArrowUpIcon data-icon="inline-start" />
          )}
          {diverged ? "Force push" : hasUpstream ? "Push" : "Publish branch"}
        </Button>
      </ButtonGroup>

      <Dialog open={forceConfirmOpen} onOpenChange={setForceConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force push?</DialogTitle>
            <DialogDescription>
              Your branch and {head?.upstream} have diverged (usually after
              amending or resetting a pushed commit). Force pushing rewrites the
              remote branch to match your local one. Uses --force-with-lease, so
              it aborts if someone else pushed new work in the meantime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setForceConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={push.isPending}
              onClick={() => doPush(true)}
            >
              {push.isPending && <Spinner data-icon="inline-start" />}
              Force push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
