import {
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  ArrowUpIcon,
  CaretDownIcon,
  UploadSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { PullMode } from "@/lib/git/api";
import {
  useAutoFetch,
  useFetchStatusStore,
  useLastFetchedAt,
} from "@/lib/git/auto-fetch";
import {
  useFetchRemote,
  useForgeStatus,
  usePublishTargets,
  usePull,
  usePush,
  useRemotes,
  useRepoStatus,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { quickTransition } from "@/lib/motion";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { PublishDialog } from "./PublishDialog";

export function SyncControls({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const remotes = useRemotes(repoPath);
  const gh = useForgeStatus(repoPath);
  const settings = useSettings();
  const repoName = useUiStore((s) => s.repoName);
  const fetchRemote = useFetchRemote(repoPath);
  const pull = usePull(repoPath);
  const push = usePush(repoPath);
  const markFetched = useFetchStatusStore((s) => s.markFetched);
  const lastFetchedAt = useLastFetchedAt(repoPath);
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishProvider, setPublishProvider] = useState<
    "github" | "gitlab" | "bitbucket"
  >("github");

  // A repo with no `origin` (e.g. created locally in GitDesktop) can't push;
  // offer to create the GitHub/GitLab repo instead. Which providers can take it
  // is probed explicitly — there's no remote to detect one from. The (usually
  // warm) forge-status cache keeps the button enabled for the common GitHub
  // case while that probe is still in flight, avoiding a flash of disabled.
  const noOrigin = remotes.isSuccess && !remotes.data.includes("origin");
  const hasOrigin = remotes.isSuccess && remotes.data.includes("origin");
  const ghCliReady = Boolean(gh.data?.installed && gh.data?.authenticated);
  const targets = usePublishTargets(repoPath, noOrigin);
  // Which providers can take this origin-less repo, in a stable GitHub → GitLab
  // → Bitbucket order. GitHub stays eligible off the (warm) CLI status while the
  // explicit probe is still in flight, matching the pre-generalized behavior.
  const PUBLISH_PROVIDERS = [
    {
      id: "github",
      label: "GitHub",
      ready: ghCliReady || targets.data?.github,
    },
    { id: "gitlab", label: "GitLab", ready: targets.data?.gitlab },
    { id: "bitbucket", label: "Bitbucket", ready: targets.data?.bitbucket },
  ] as const;
  const readyProviders = PUBLISH_PROVIDERS.filter((p) => p.ready);
  const canPublish = readyProviders.length > 0;

  const head = status.data?.branch;
  const hasUpstream = Boolean(head?.upstream);
  // amended/rewritten local history: local and remote both have commits the
  // other lacks, so neither pull --ff-only nor a normal push can succeed
  const diverged = Boolean(head && head.ahead > 0 && head.behind > 0);
  const busy = fetchRemote.isPending || pull.isPending || push.isPending;
  const onError = (e: unknown) => toastError(e);

  // One entry point for every fetch — manual (button/hotkey) and automatic —
  // so a successful fetch always records its freshness. Auto-fetches stay quiet
  // (a failed background fetch just retries next tick).
  function doFetch(silent: boolean) {
    fetchRemote.mutate(undefined, {
      onSuccess: () => markFetched(repoPath),
      onError: silent ? undefined : onError,
    });
  }

  // Opt-out periodic background fetch (Settings → General). Shares the fetch
  // mutation above, so the Fetch spinner covers it too.
  useAutoFetch({
    repoPath,
    enabled: settings.data?.autoFetch ?? false,
    intervalMs: Number(settings.data?.autoFetchInterval ?? "10") * 60_000,
    hasOrigin,
    busy,
    fetch: () => doFetch(true),
  });

  // Keep the Fetch tooltip's relative time honest while the window sits idle
  // (the status poll only re-renders on change). Cheap; only while we have a
  // timestamp to age.
  const [, tick] = useState(0);
  useEffect(() => {
    if (lastFetchedAt === undefined) return;
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [lastFetchedAt]);

  const fetchTitle =
    lastFetchedAt === undefined
      ? "Fetch from origin"
      : `Last fetched ${formatRelativeTime(new Date(lastFetchedAt).toISOString())}`;

  // Hotkeys mirror the buttons' disabled states exactly.
  useHotkeyAction("fetch", () => doFetch(false), !noOrigin && !busy);
  useHotkeyAction(
    "pull",
    () => doPull("ffOnly"),
    !noOrigin && !busy && hasUpstream && !diverged,
  );

  function doPull(mode: PullMode) {
    pull.mutate(mode, {
      onSuccess: () => {
        if (mode === "rebase") toast.success("Pulled with rebase");
        else if (mode === "merge") toast.success("Pulled with merge");
      },
      onError,
    });
  }
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

  function openPublish(provider: "github" | "gitlab" | "bitbucket") {
    setPublishProvider(provider);
    setPublishOpen(true);
  }

  if (noOrigin) {
    const soleTarget = readyProviders[0];
    return (
      <>
        {readyProviders.length >= 2 ? (
          // Multiple CLIs/accounts are ready: the button becomes a provider choice.
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              <UploadSimpleIcon data-icon="inline-start" />
              Publish repository…
              <CaretDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {readyProviders.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => openPublish(p.id)}>
                  Publish to {p.label}…
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!canPublish}
            onClick={() => soleTarget && openPublish(soleTarget.id)}
            title={
              soleTarget
                ? `Create a ${soleTarget.label} repository and push this one`
                : "Sign in with the GitHub CLI (gh auth login), GitLab CLI (glab auth login), or connect a Bitbucket account to publish"
            }
          >
            <UploadSimpleIcon data-icon="inline-start" />
            Publish repository…
          </Button>
        )}
        <PublishDialog
          repoPath={repoPath}
          provider={publishProvider}
          defaultName={repoName ?? ""}
          open={publishOpen}
          onOpenChange={setPublishOpen}
        />
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <AnimatePresence>
        {head && head.ahead > 0 && (
          <m.div
            key="ahead"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={quickTransition}
          >
            <Badge variant="secondary">
              <ArrowUpIcon className="size-3" />
              {head.ahead}
            </Badge>
          </m.div>
        )}
        {head && head.behind > 0 && (
          <m.div
            key="behind"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={quickTransition}
          >
            <Badge variant="secondary">
              <ArrowDownIcon className="size-3" />
              {head.behind}
            </Badge>
          </m.div>
        )}
      </AnimatePresence>
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          title={fetchTitle}
          onClick={() => doFetch(false)}
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
          title={
            diverged
              ? "Branch has diverged — use Pull with rebase or merge from the menu"
              : undefined
          }
          onClick={() => doPull("ffOnly")}
        >
          {pull.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowDownIcon data-icon="inline-start" />
          )}
          Pull
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                aria-label="Pull options"
                disabled={busy || !hasUpstream}
                className="px-1.5"
              >
                <CaretDownIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onClick={() => doPull("rebase")}>
              Pull with rebase
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => doPull("merge")}>
              Pull with merge
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
