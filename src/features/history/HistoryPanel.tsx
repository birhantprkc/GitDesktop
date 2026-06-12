import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/clipboard";
import { required, useAppForm } from "@/lib/form";
import { gitCommitDetails } from "@/lib/git/api";
import {
  useBranches,
  useCheckoutCommit,
  useCherryPick,
  useCherryPickOnto,
  useCreateBranch,
  useCreateTag,
  useLog,
  useRepoStatus,
  useResetToCommit,
  useRevertCommit,
  useUndoCommit,
} from "@/lib/git/queries";
import { refNameWarning, sanitizeRefName } from "@/lib/git/ref-name";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAmendCommit } from "./useAmendCommit";

export function HistoryPanel({ repoPath }: { repoPath: string }) {
  const log = useLog(repoPath);
  const status = useRepoStatus(repoPath);
  const undoCommit = useUndoCommit(repoPath);
  const selectedCommitHash = useUiStore((s) => s.selectedCommitHash);
  const selectCommit = useUiStore((s) => s.selectCommit);
  const setCommitDraft = useUiStore((s) => s.setCommitDraft);
  const setRepoTab = useUiStore((s) => s.setRepoTab);

  const resetMutation = useResetToCommit(repoPath);
  const checkoutCommit = useCheckoutCommit(repoPath);
  const revertCommit = useRevertCommit(repoPath);
  const cherryPick = useCherryPick(repoPath);
  const cherryPickOnto = useCherryPickOnto(repoPath);
  const createBranch = useCreateBranch(repoPath);
  const createTag = useCreateTag(repoPath);
  const branches = useBranches(repoPath);

  const [resetHash, setResetHash] = useState<string | null>(null);
  const [branchHash, setBranchHash] = useState<string | null>(null);
  const [tagHash, setTagHash] = useState<string | null>(null);
  // Multi-/range-selection for "cherry-pick to branch". Kept separate from the
  // ui store's focused commit (which drives the diff panel).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  // Hashes to copy, oldest-first, and the chosen destination branch.
  const [pickOntoHashes, setPickOntoHashes] = useState<string[] | null>(null);
  const [pickOntoBranch, setPickOntoBranch] = useState("");
  const [filterText, setFilterText] = useState("");

  const onError = (e: unknown) => toastError(e);

  const currentBranch = status.data?.branch?.name ?? null;
  const targetBranches = (branches.data ?? []).filter((b) => !b.isCurrent);

  const branchForm = useAppForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      if (!branchHash) return;
      const name = sanitizeRefName(value.name);
      try {
        await createBranch.mutateAsync({
          name,
          checkout: true,
          startPoint: branchHash,
        });
        toast.success(`Created branch ${name}`);
        setBranchHash(null);
      } catch (e) {
        onError(e);
      }
    },
  });

  const tagForm = useAppForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      if (!tagHash) return;
      const name = sanitizeRefName(value.name);
      try {
        await createTag.mutateAsync({ name, hash: tagHash });
        toast.success(`Created tag ${name}`);
        setTagHash(null);
      } catch (e) {
        onError(e);
      }
    },
  });

  const amendCommit = useAmendCommit(repoPath);

  async function startAmend(hash: string) {
    try {
      await amendCommit(hash);
    } catch (e) {
      onError(e);
    }
  }

  // GitHub Desktop-style undo: offered while the latest commit hasn't been
  // pushed anywhere (no upstream, or we're ahead of it).
  const head = status.data?.branch;
  const lastCommit = log.data?.pages[0]?.[0];
  const canUndo = Boolean(
    lastCommit && head && (head.upstream === null || head.ahead > 0),
  );

  async function undoLast() {
    if (!lastCommit) return;
    try {
      const details = await gitCommitDetails(repoPath, lastCommit.hash);
      undoCommit.mutate(undefined, {
        onSuccess: () => {
          setCommitDraft(details.subject, details.body);
          setRepoTab("changes");
          toast.success(
            `Undid ${lastCommit.hash.slice(0, 7)} — changes are staged again`,
          );
        },
        onError,
      });
    } catch (e) {
      onError(e);
    }
  }

  if (log.isPending) {
    return (
      <div className="flex-1 space-y-3 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const commits = log.data?.pages.flat() ?? [];
  if (commits.length === 0) {
    return (
      <p className="flex-1 px-2 py-8 text-center text-xs text-muted-foreground">
        No commits yet
      </p>
    );
  }

  // Client-side filter over the loaded pages (subject, author, or SHA).
  const query = filterText.trim().toLowerCase();
  const visibleCommits = query
    ? commits.filter(
        (c) =>
          c.subject.toLowerCase().includes(query) ||
          c.author.toLowerCase().includes(query) ||
          c.hash.toLowerCase().startsWith(query),
      )
    : commits;

  function onRowClick(e: React.MouseEvent, index: number, hash: string) {
    // Keep the diff panel on the clicked commit regardless of modifiers.
    selectCommit(hash);
    if (e.shiftKey && anchorIndex !== null) {
      // Indices are positions in the rendered (possibly filtered) list.
      const [a, b] = [anchorIndex, index].sort((x, y) => x - y);
      setSelected(new Set(visibleCommits.slice(a, b + 1).map((c) => c.hash)));
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      setSelected(next);
      setAnchorIndex(index);
    } else {
      setSelected(new Set([hash]));
      setAnchorIndex(index);
    }
  }

  // The commits a context-menu action applies to: the multi-selection when the
  // right-clicked commit is part of it, otherwise just that one commit.
  function effectiveSelection(hash: string): string[] {
    const base =
      selected.has(hash) && selected.size > 1 ? selected : new Set([hash]);
    // Cherry-pick wants oldest-first; the log is newest-first.
    return commits
      .filter((c) => base.has(c.hash))
      .map((c) => c.hash)
      .reverse();
  }

  function openCherryPickOnto(hash: string) {
    setPickOntoHashes(effectiveSelection(hash));
    setPickOntoBranch(targetBranches[0]?.name ?? "");
  }

  function runCherryPickOnto() {
    if (!pickOntoHashes || !pickOntoBranch) return;
    const branch = pickOntoBranch;
    cherryPickOnto.mutate(
      { hashes: pickOntoHashes, targetBranch: branch },
      {
        onSuccess: ({ applied, skipped }) => {
          if (applied === 0) {
            toast.info(
              `Nothing to copy onto ${branch} — those changes are already there.`,
            );
          } else {
            const note = skipped > 0 ? ` (${skipped} already present)` : "";
            toast.success(
              `Copied ${applied} commit${applied === 1 ? "" : "s"} onto ${branch}${note}`,
            );
          }
          setPickOntoHashes(null);
          setSelected(new Set());
        },
        onError: (e) => {
          onError(e);
          setPickOntoHashes(null);
        },
      },
    );
  }

  return (
    <>
      {canUndo && lastCommit && (
        <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1.5 text-xs">
          <span
            className="truncate text-muted-foreground"
            title={lastCommit.subject}
          >
            Unpushed: {lastCommit.subject}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={undoCommit.isPending}
            onClick={undoLast}
            title="Undo the last commit, keeping its changes staged"
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            Undo
          </Button>
        </div>
      )}
      <div className="border-b p-2">
        <Input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter by subject, author, or SHA"
          className="h-7"
          autoComplete="off"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div>
          {visibleCommits.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No loaded commits match the filter
            </p>
          )}
          {visibleCommits.map((commit, index) => (
            <ContextMenu key={commit.hash}>
              <ContextMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "block w-full border-b px-3 py-2 text-left",
                      selected.has(commit.hash) ||
                        (selected.size === 0 &&
                          selectedCommitHash === commit.hash)
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60",
                    )}
                    onClick={(e) => onRowClick(e, index, commit.hash)}
                  >
                    <p className="truncate text-xs font-medium">
                      {commit.subject}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="flex size-3.5 items-center justify-center rounded-full bg-muted text-[8px] uppercase">
                        {commit.author.slice(0, 1)}
                      </span>
                      <span className="truncate">{commit.author}</span>
                      <span>•</span>
                      <span className="shrink-0">
                        {formatRelativeTime(commit.date)}
                      </span>
                    </p>
                  </button>
                }
              />
              <ContextMenuContent className="min-w-60">
                <ContextMenuItem
                  disabled={index !== 0}
                  onClick={() => startAmend(commit.hash)}
                >
                  Amend commit…
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={index === 0}
                  onClick={() => setResetHash(commit.hash)}
                >
                  Reset to commit…
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    checkoutCommit.mutate(commit.hash, { onError })
                  }
                >
                  Checkout commit
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => revertCommit.mutate(commit.hash, { onError })}
                >
                  Revert changes in commit
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => {
                    branchForm.reset({ name: "" });
                    setBranchHash(commit.hash);
                  }}
                >
                  Create branch from commit…
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    tagForm.reset({ name: "" });
                    setTagHash(commit.hash);
                  }}
                >
                  Create tag…
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    cherryPick.mutate(commit.hash, {
                      onSuccess: (applied) => {
                        if (applied) {
                          toast.success(
                            `Cherry-picked ${commit.hash.slice(0, 7)}`,
                          );
                        } else {
                          toast.info(
                            "Nothing to cherry-pick — these changes are already on this branch.",
                          );
                        }
                      },
                      onError,
                    })
                  }
                >
                  Cherry-pick commit
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={targetBranches.length === 0}
                  onClick={() => openCherryPickOnto(commit.hash)}
                >
                  {selected.has(commit.hash) && selected.size > 1
                    ? `Cherry-pick ${selected.size} commits to branch…`
                    : "Cherry-pick to branch…"}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => copyText(commit.hash, "SHA copied")}
                >
                  Copy SHA
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {log.hasNextPage && (
            <div className="px-3 py-2 text-center">
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                disabled={log.isFetchingNextPage}
                onClick={() => log.fetchNextPage()}
              >
                {log.isFetchingNextPage && <Spinner data-icon="inline-start" />}
                Load more ({commits.length} loaded
                {query ? " — the filter only searches these" : ""})
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog
        open={resetHash !== null}
        onOpenChange={(open) => {
          if (!open) setResetHash(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to commit?</DialogTitle>
            <DialogDescription>
              Moves the current branch to {resetHash?.slice(0, 7)}. Changes from
              later commits stay in your working tree as uncommitted changes
              (mixed reset). Commits that were only on this branch will be
              orphaned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetHash(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={resetMutation.isPending}
              onClick={() => {
                if (!resetHash) return;
                resetMutation.mutate(resetHash, {
                  onSuccess: () => {
                    toast.success(`Reset to ${resetHash.slice(0, 7)}`);
                    setResetHash(null);
                  },
                  onError: (e) => {
                    onError(e);
                    setResetHash(null);
                  },
                });
              }}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={branchHash !== null}
        onOpenChange={(open) => {
          if (!open) setBranchHash(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create branch from commit</DialogTitle>
            <DialogDescription>
              Creates a branch starting at {branchHash?.slice(0, 7)} and
              switches to it.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              branchForm.handleSubmit();
            }}
          >
            <branchForm.AppField
              name="name"
              validators={{ onChange: ({ value }) => required(value) }}
            >
              {(field) => (
                <field.TextField
                  label="Branch name"
                  placeholder="feature/from-commit"
                  warning={refNameWarning}
                />
              )}
            </branchForm.AppField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBranchHash(null)}
              >
                Cancel
              </Button>
              <branchForm.AppForm>
                <branchForm.SubmitButton>Create branch</branchForm.SubmitButton>
              </branchForm.AppForm>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tagHash !== null}
        onOpenChange={(open) => {
          if (!open) setTagHash(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create tag</DialogTitle>
            <DialogDescription>
              Tags commit {tagHash?.slice(0, 7)}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              tagForm.handleSubmit();
            }}
          >
            <tagForm.AppField
              name="name"
              validators={{ onChange: ({ value }) => required(value) }}
            >
              {(field) => (
                <field.TextField
                  label="Tag name"
                  placeholder="v1.0.0"
                  warning={refNameWarning}
                />
              )}
            </tagForm.AppField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTagHash(null)}
              >
                Cancel
              </Button>
              <tagForm.AppForm>
                <tagForm.SubmitButton>Create tag</tagForm.SubmitButton>
              </tagForm.AppForm>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pickOntoHashes !== null}
        onOpenChange={(open) => {
          if (!open) setPickOntoHashes(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cherry-pick to branch</DialogTitle>
            <DialogDescription>
              {pickOntoHashes && pickOntoHashes.length > 1
                ? `Copies these ${pickOntoHashes.length} commits onto the chosen branch and switches to it. `
                : "Copies this commit onto the chosen branch and switches to it. "}
              They stay on {currentBranch ?? "this branch"} too. Commits already
              present are skipped; a conflict rolls the whole thing back.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Destination branch</Label>
            <Select
              items={Object.fromEntries(
                targetBranches.map((b) => [b.name, b.name]),
              )}
              value={pickOntoBranch || null}
              onValueChange={(v) => v && setPickOntoBranch(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targetBranches.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickOntoHashes(null)}>
              Cancel
            </Button>
            <Button
              onClick={runCherryPickOnto}
              disabled={!pickOntoBranch || cherryPickOnto.isPending}
            >
              Cherry-pick
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
