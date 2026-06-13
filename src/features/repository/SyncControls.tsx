import {
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  ArrowUpIcon,
  UploadSimpleIcon,
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
  useGhStatus,
  usePull,
  usePush,
  useRemotes,
  useRepoStatus,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { PublishDialog } from "./PublishDialog";

export function SyncControls({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const remotes = useRemotes(repoPath);
  const gh = useGhStatus(repoPath);
  const repoName = useUiStore((s) => s.repoName);
  const fetchRemote = useFetchRemote(repoPath);
  const pull = usePull(repoPath);
  const push = usePush(repoPath);
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  // A repo with no `origin` (e.g. created locally in GitDesktop) can't push;
  // offer to create the GitHub repo instead.
  const noOrigin = remotes.isSuccess && !remotes.data.includes("origin");
  const canGh = Boolean(gh.data?.installed && gh.data?.authenticated);

  const head = status.data?.branch;
  const hasUpstream = Boolean(head?.upstream);
  // amended/rewritten local history: local and remote both have commits the
  // other lacks, so neither pull --ff-only nor a normal push can succeed
  const diverged = Boolean(head && head.ahead > 0 && head.behind > 0);
  const busy = fetchRemote.isPending || pull.isPending || push.isPending;
  const onError = (e: unknown) => toastError(e);

  // Hotkeys mirror the buttons' disabled states exactly.
  useHotkeyAction(
    "fetch",
    () => fetchRemote.mutate(undefined, { onError }),
    !noOrigin && !busy,
  );
  useHotkeyAction(
    "pull",
    () => pull.mutate(undefined, { onError }),
    !noOrigin && !busy && hasUpstream && !diverged,
  );
  useHotkeyAction(
    "push",
    () => (diverged ? setForceConfirmOpen(true) : doPush(false)),
    !noOrigin && !busy,
  );

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

  if (noOrigin) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          disabled={!canGh}
          onClick={() => setPublishOpen(true)}
          title={
            canGh
              ? "Create a GitHub repository and push this one"
              : "Sign in with the GitHub CLI (gh auth login) to publish"
          }
        >
          <UploadSimpleIcon data-icon="inline-start" />
          Publish repository…
        </Button>
        <PublishDialog
          repoPath={repoPath}
          defaultName={repoName ?? ""}
          open={publishOpen}
          onOpenChange={setPublishOpen}
        />
      </>
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
