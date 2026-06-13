import { TagIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { AmendForcePushDialog } from "@/features/commit/AmendForcePushDialog";
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
  useDeleteTag,
  useLog,
  usePushTag,
  useRepoStatus,
  useResetToCommit,
  useRevertCommit,
  useUndoCommit,
} from "@/lib/git/queries";
import { refNameWarning, sanitizeRefName } from "@/lib/git/ref-name";
import type { RewriteStep } from "@/lib/git/types";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ReorderDialog, SquashDialog } from "./RewriteDialogs";
import { useAmendWithConfirm } from "./useAmendCommit";

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
  const pushTag = usePushTag(repoPath);
  const deleteTag = useDeleteTag(repoPath);
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
  const filterRef = useRef<HTMLInputElement>(null);
  // Tag pending deletion, plus whether to delete it from origin too.
  const [deleteTagName, setDeleteTagName] = useState<string | null>(null);
  const [deleteTagRemote, setDeleteTagRemote] = useState(false);
  // History rewriting (squash / reorder), unpushed commits only.
  const [squashCtx, setSquashCtx] = useState<{
    base: string;
    steps: RewriteStep[];
    count: number;
    defaultMessage: string;
  } | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);

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

  const { requestAmend, forcePushDialog } = useAmendWithConfirm(repoPath);

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

  useHotkeyAction("undo-commit", undoLast, canUndo && !undoCommit.isPending);
  useHotkeyAction("focus-filter", () => filterRef.current?.focus());

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

  // Right-clicking a commit outside the selection collapses the selection
  // to it (standard desktop behavior) — the context menu then always
  // describes exactly what it acts on.
  function onRowContextMenu(index: number, hash: string) {
    if (!selected.has(hash)) {
      setSelected(new Set([hash]));
      setAnchorIndex(index);
      selectCommit(hash);
    }
  }

  // Arrow keys walk the history selection; Shift extends it from the anchor.
  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (visibleCommits.length === 0) return;
    // Move the selection, not the scrollbar.
    e.preventDefault();
    const current = visibleCommits.findIndex(
      (c) => c.hash === selectedCommitHash,
    );
    const next =
      e.key === "ArrowDown"
        ? Math.min(current + 1, visibleCommits.length - 1)
        : current === -1
          ? visibleCommits.length - 1
          : Math.max(current - 1, 0);
    const commit = visibleCommits[next];
    selectCommit(commit.hash);
    if (e.shiftKey && anchorIndex !== null) {
      const [a, b] = [anchorIndex, next].sort((x, y) => x - y);
      setSelected(new Set(visibleCommits.slice(a, b + 1).map((c) => c.hash)));
    } else {
      setSelected(new Set([commit.hash]));
      setAnchorIndex(next);
    }
    // Move focus along with the selection so the focus ring tracks it.
    const el = e.currentTarget.querySelector<HTMLElement>(
      `[data-hash="${CSS.escape(commit.hash)}"]`,
    );
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
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

  // Rewriting may only touch commits that aren't on the remote: the top
  // `ahead` commits, or everything (minus the root) when there's no upstream.
  const unpushedCount = head
    ? head.upstream
      ? head.ahead
      : commits.length
    : 0;

  // Squash: the selection must be >1, contiguous in real history (not the
  // filtered view), entirely unpushed, and have a commit below it as base.
  const selectedIndices = commits
    .map((c, i) => (selected.has(c.hash) ? i : -1))
    .filter((i) => i >= 0);
  const squashMax = selectedIndices.at(-1) ?? -1;
  const canSquash =
    selectedIndices.length > 1 &&
    squashMax - (selectedIndices[0] ?? 0) + 1 === selectedIndices.length &&
    squashMax < unpushedCount &&
    squashMax + 1 < commits.length &&
    // The replayed range (everything above the base) must be merge-free.
    commits.slice(0, squashMax + 1).every((c) => !c.isMerge);

  function openSquash() {
    if (!canSquash) return;
    const minIdx = selectedIndices[0];
    const run = commits.slice(minIdx, squashMax + 1);
    // Steps replay base..HEAD oldest-first with the run collapsed.
    const steps: RewriteStep[] = [
      { hashes: [...run].reverse().map((c) => c.hash), message: "" },
      ...commits
        .slice(0, minIdx)
        .reverse()
        .map((c) => ({ hashes: [c.hash] })),
    ];
    setSquashCtx({
      base: commits[squashMax + 1].hash,
      steps,
      count: run.length,
      defaultMessage: [...run]
        .reverse()
        .map((c) => c.subject)
        .join("\n\n"),
    });
  }

  // Reorder: the top unpushed commits (capped), needing a base below them.
  // Merge commits can't be replayed, so the range stops at the first one.
  const REORDER_MAX = 15;
  const firstMerge = commits.findIndex((c) => c.isMerge);
  let reorderLen = Math.min(
    unpushedCount,
    REORDER_MAX,
    commits.length,
    firstMerge === -1 ? Number.POSITIVE_INFINITY : firstMerge,
  );
  if (reorderLen === commits.length && !log.hasNextPage) reorderLen -= 1;
  const canReorder = reorderLen >= 2;
  const reorderCommits = commits.slice(0, Math.max(reorderLen, 0));
  const reorderBase = commits[Math.max(reorderLen, 0)]?.hash ?? "";

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
      <div className="border-b p-2">
        <Input
          ref={filterRef}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter by subject, author, or SHA"
          className="h-7"
          autoComplete="off"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div onKeyDown={onListKeyDown}>
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
                    data-hash={commit.hash}
                    className={cn(
                      "block w-full border-b px-3 py-2 text-left",
                      selected.has(commit.hash) ||
                        (selected.size === 0 &&
                          selectedCommitHash === commit.hash)
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60",
                    )}
                    onClick={(e) => onRowClick(e, index, commit.hash)}
                    onContextMenu={() => onRowContextMenu(index, commit.hash)}
                  >
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <span className="min-w-0 truncate">{commit.subject}</span>
                      {commit.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="flex max-w-24 shrink-0 items-center gap-0.5 border px-1 py-px text-[10px] font-normal text-muted-foreground"
                          title={`tag: ${tag}`}
                        >
                          <TagIcon className="size-2.5 shrink-0" />
                          <span className="truncate">{tag}</span>
                        </span>
                      ))}
                      {commit.tags.length > 2 && (
                        <span
                          className="shrink-0 text-[10px] font-normal text-muted-foreground"
                          title={commit.tags.join(", ")}
                        >
                          +{commit.tags.length - 2}
                        </span>
                      )}
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
              {selected.has(commit.hash) && selected.size > 1 ? (
                /* Multi-selection: only actions that apply to the whole
                   selection, so nothing silently targets one commit. */
                <ContextMenuContent className="min-w-60">
                  <ContextMenuItem
                    disabled={targetBranches.length === 0}
                    onClick={() => openCherryPickOnto(commit.hash)}
                  >
                    Cherry-pick {selected.size} commits to branch…
                  </ContextMenuItem>
                  <ContextMenuItem disabled={!canSquash} onClick={openSquash}>
                    Squash {selected.size} commits…
                    {!canSquash && " (must be adjacent and unpushed)"}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!canReorder}
                    onClick={() => setReorderOpen(true)}
                  >
                    Reorder unpushed commits…
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() =>
                      copyText(
                        effectiveSelection(commit.hash).reverse().join("\n"),
                        `${selected.size} SHAs copied`,
                      )
                    }
                  >
                    Copy {selected.size} SHAs
                  </ContextMenuItem>
                </ContextMenuContent>
              ) : (
                <ContextMenuContent className="min-w-60">
                  <ContextMenuItem
                    disabled={index !== 0}
                    onClick={() => requestAmend(commit.hash)}
                  >
                    Amend commit…
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={index !== 0 || !canUndo || undoCommit.isPending}
                    onClick={undoLast}
                  >
                    Undo commit (keep changes)
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
                    onClick={() =>
                      revertCommit.mutate(commit.hash, { onError })
                    }
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
                    Cherry-pick to branch…
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!canReorder || index >= reorderLen}
                    onClick={() => setReorderOpen(true)}
                  >
                    Reorder unpushed commits…
                  </ContextMenuItem>
                  {commit.tags.length > 0 && <ContextMenuSeparator />}
                  {commit.tags.map((tag) => (
                    <ContextMenuItem
                      key={`push:${tag}`}
                      onClick={() =>
                        pushTag.mutate(tag, {
                          onSuccess: () =>
                            toast.success(`Pushed tag ${tag} to origin`),
                          onError,
                        })
                      }
                    >
                      Push tag {tag} to origin
                    </ContextMenuItem>
                  ))}
                  {commit.tags.map((tag) => (
                    <ContextMenuItem
                      key={`delete:${tag}`}
                      onClick={() => {
                        setDeleteTagRemote(false);
                        setDeleteTagName(tag);
                      }}
                    >
                      Delete tag {tag}…
                    </ContextMenuItem>
                  ))}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => copyText(commit.hash, "SHA copied")}
                  >
                    Copy SHA
                  </ContextMenuItem>
                </ContextMenuContent>
              )}
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

      {squashCtx && (
        <SquashDialog
          repoPath={repoPath}
          base={squashCtx.base}
          steps={squashCtx.steps}
          count={squashCtx.count}
          defaultMessage={squashCtx.defaultMessage}
          open
          onOpenChange={(open) => {
            if (!open) setSquashCtx(null);
          }}
          onDone={() => setSelected(new Set())}
        />
      )}

      <ReorderDialog
        repoPath={repoPath}
        base={reorderBase}
        commits={reorderCommits}
        open={reorderOpen}
        onOpenChange={setReorderOpen}
        onDone={() => setSelected(new Set())}
      />

      <AmendForcePushDialog {...forcePushDialog} />

      <Dialog
        open={deleteTagName !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTagName(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tag {deleteTagName}?</DialogTitle>
            <DialogDescription>
              Removes the tag from this repository. The commit it points at is
              not affected.
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={deleteTagRemote}
              onCheckedChange={(v) => setDeleteTagRemote(v === true)}
            />
            Also delete the tag on origin
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTagName(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTag.isPending}
              onClick={() => {
                if (!deleteTagName) return;
                deleteTag.mutate(
                  { name: deleteTagName, onRemote: deleteTagRemote },
                  {
                    onSuccess: () => {
                      toast.success(
                        `Deleted tag ${deleteTagName}${deleteTagRemote ? " (local and origin)" : ""}`,
                      );
                      setDeleteTagName(null);
                    },
                    onError: (e) => {
                      onError(e);
                      setDeleteTagName(null);
                    },
                  },
                );
              }}
            >
              {deleteTag.isPending && <Spinner data-icon="inline-start" />}
              Delete tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
