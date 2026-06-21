import {
  ArrowLeftIcon,
  ArrowUpIcon,
  GitCommitIcon,
  MagnifyingGlassIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { type MouseEvent, useMemo, useRef, useState } from "react";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AmendForcePushDialog } from "@/features/commit/AmendForcePushDialog";
import { copyText } from "@/lib/clipboard";
import { useAppForm } from "@/lib/form";
import { gitCommitDetails } from "@/lib/git/api";
import {
  useBranches,
  useCheckoutCommit,
  useCherryPick,
  useCommitSearch,
  useCreateBranch,
  useCreateTag,
  useHoverPrefetch,
  useLog,
  usePrefetchCommit,
  usePushTag,
  useRepoStatus,
  useRevertCommit,
  useUndoCommit,
} from "@/lib/git/queries";
import { sanitizeRefName } from "@/lib/git/ref-name";
import type { CommitSummary, RewriteStep } from "@/lib/git/types";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  CherryPickOntoDialog,
  CreateRefFromCommitDialog,
  createRefFromCommitFormOpts,
  DeleteTagDialog,
  ResetCommitDialog,
} from "./HistoryDialogs";
import { ReorderDialog, SquashDialog } from "./RewriteDialogs";
import { useAmendWithConfirm } from "./useAmendCommit";

export function HistoryPanel({ repoPath }: { repoPath: string }) {
  const log = useLog(repoPath);
  const status = useRepoStatus(repoPath);
  const undoCommit = useUndoCommit(repoPath);
  const selectedCommitHash = useUiStore((s) => s.selectedCommitHash);
  const selectCommit = useUiStore((s) => s.selectCommit);
  const prefetchCommit = usePrefetchCommit(repoPath);
  const hoverPrefetch = useHoverPrefetch();
  const setCommitDraft = useUiStore((s) => s.setCommitDraft);
  const setRepoTab = useUiStore((s) => s.setRepoTab);

  const checkoutCommit = useCheckoutCommit(repoPath);
  const revertCommit = useRevertCommit(repoPath);
  const cherryPick = useCherryPick(repoPath);
  const createBranch = useCreateBranch(repoPath);
  const createTag = useCreateTag(repoPath);
  const pushTag = usePushTag(repoPath);
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
  // "Search all history" mode: server-side message grep across every commit,
  // not just the loaded pages. Kept separate from the operational log so the
  // rewrite/amend actions still see contiguous recent history.
  const [searchMode, setSearchMode] = useState(false);
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
  // The commit (+ its row index) the one shared context menu acts on.
  const [menuTarget, setMenuTarget] = useState<{
    commit: CommitSummary;
    index: number;
  } | null>(null);

  const searchActive = searchMode && filterText.trim().length > 0;
  const search = useCommitSearch(
    repoPath,
    searchActive ? filterText.trim() : "",
  );

  const onError = (e: unknown) => toastError(e);

  const currentBranch = status.data?.branch?.name ?? null;
  const targetBranches = (branches.data ?? []).filter((b) => !b.isCurrent);

  const branchForm = useAppForm({
    ...createRefFromCommitFormOpts,
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
    ...createRefFromCommitFormOpts,
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

  // Derived commit lists — memoized so the per-render .flat()/.filter()/.map()
  // allocations don't churn (they feed the list + selection gating on every
  // keystroke). Computed before the early returns to satisfy the rules of hooks;
  // harmlessly empty while the log is still loading.
  const commits = useMemo(() => log.data?.pages.flat() ?? [], [log.data]);
  const searchCommits = useMemo(
    () => search.data?.pages.flat() ?? [],
    [search.data],
  );
  // Client-side filter over the loaded pages (subject, author, or SHA).
  const query = filterText.trim().toLowerCase();
  const filteredCommits = useMemo(
    () =>
      query
        ? commits.filter(
            (c) =>
              c.subject.toLowerCase().includes(query) ||
              c.author.toLowerCase().includes(query) ||
              c.hash.toLowerCase().startsWith(query),
          )
        : commits,
    [commits, query],
  );
  // In search mode the list is whole-history grep results; otherwise it's the
  // (client-filtered) loaded pages.
  const visibleCommits = searchActive ? searchCommits : filteredCommits;
  // Squash gating needs the selection's positions in REAL history (not the
  // filtered view), so index against `commits`.
  const selectedIndices = useMemo(
    () =>
      commits
        .map((c, i) => (selected.has(c.hash) ? i : -1))
        .filter((i) => i >= 0),
    [commits, selected],
  );

  // Commits not yet on the remote: the top `ahead` commits, or everything when
  // there's no upstream (an unpublished branch — all commits are unpushed).
  // Drives both the rewrite gating below and the per-row "not pushed" marker.
  const unpushedCount = head
    ? head.upstream
      ? head.ahead
      : commits.length
    : 0;
  // The unpushed set (top `unpushedCount` of the HEAD-order log), for marking
  // rows. Memoized — the React Compiler won't hoist the .slice/.map/new Set.
  // Auto-clears after a push: useRepoStatus refetches, head.ahead → 0.
  const unpushedHashes = useMemo(
    () => new Set(commits.slice(0, unpushedCount).map((c) => c.hash)),
    [commits, unpushedCount],
  );

  if (log.isPending) {
    return (
      <div className="flex-1 space-y-3 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitCommitIcon />
          </EmptyMedia>
          <EmptyTitle>No commits yet</EmptyTitle>
          <EmptyDescription>
            Your project's history shows up here. Make a change, then stage and
            commit it to record your first commit.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRepoTab("changes")}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Go to Changes
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  function onRowClick(e: React.MouseEvent, index: number, hash: string) {
    // Keep the diff panel on the clicked commit regardless of modifiers.
    selectCommit(hash);
    // Search results aren't contiguous history — single-select only there.
    if (searchActive) {
      setSelected(new Set([hash]));
      setAnchorIndex(null);
      return;
    }
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
  const onListKeyDown = listKeyboardNav({
    items: visibleCommits,
    activeIndex: visibleCommits.findIndex((c) => c.hash === selectedCommitHash),
    rowKey: (c) => c.hash,
    rowAttr: "data-hash",
    onActivate: (commit, to, shift) => {
      selectCommit(commit.hash);
      if (shift && anchorIndex !== null) {
        const [a, b] = [anchorIndex, to].sort((x, y) => x - y);
        setSelected(new Set(visibleCommits.slice(a, b + 1).map((c) => c.hash)));
      } else {
        setSelected(new Set([commit.hash]));
        setAnchorIndex(to);
      }
    },
  });

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

  // Squash: the selection must be >1, contiguous in real history (not the
  // filtered view), entirely unpushed, and have a commit below it as base.
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

  // One shared context menu for the whole list (capture phase, so it records the
  // right-clicked row before the menu opens) instead of a portal per commit.
  // Mirrors the old per-row onContextMenu's selection-collapse, then captures
  // the target; a right-click on blank space hits no row → suppress the menu.
  function handleCommitContextMenu(e: MouseEvent) {
    const rowEl = (e.target as HTMLElement).closest("[data-hash]");
    const hash = rowEl?.getAttribute("data-hash");
    const index = hash ? visibleCommits.findIndex((c) => c.hash === hash) : -1;
    if (index < 0) {
      setMenuTarget(null);
      e.preventDefault();
      return;
    }
    onRowContextMenu(index, visibleCommits[index].hash);
    setMenuTarget({ commit: visibleCommits[index], index });
  }

  // The items for whichever commit was right-clicked — three exclusive variants:
  // search results (position-independent), a multi-selection, or a single commit.
  function renderCommitMenu() {
    if (!menuTarget) return null;
    const { commit, index } = menuTarget;
    if (searchActive) {
      // Search results: only position-independent, single-commit actions (no
      // amend/reset/squash/reorder, which assume contiguous recent history).
      return (
        <>
          <ContextMenuItem
            onClick={() => checkoutCommit.mutate(commit.hash, { onError })}
          >
            Checkout commit
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => revertCommit.mutate(commit.hash, { onError })}
          >
            Revert changes in commit
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() =>
              cherryPick.mutate(commit.hash, {
                onSuccess: (applied) =>
                  applied
                    ? toast.success(`Cherry-picked ${commit.hash.slice(0, 7)}`)
                    : toast.info(
                        "Nothing to cherry-pick — already on this branch.",
                      ),
                onError,
              })
            }
          >
            Cherry-pick commit
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
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => copyText(commit.hash, "SHA copied")}>
            Copy SHA
          </ContextMenuItem>
        </>
      );
    }
    if (selected.has(commit.hash) && selected.size > 1) {
      // Multi-selection: only actions that apply to the whole selection, so
      // nothing silently targets one commit.
      return (
        <>
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
        </>
      );
    }
    return (
      <>
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
          onClick={() => checkoutCommit.mutate(commit.hash, { onError })}
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
                  toast.success(`Cherry-picked ${commit.hash.slice(0, 7)}`);
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
                onSuccess: () => toast.success(`Pushed tag ${tag} to origin`),
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
        <ContextMenuItem onClick={() => copyText(commit.hash, "SHA copied")}>
          Copy SHA
        </ContextMenuItem>
      </>
    );
  }

  return (
    <>
      <div className="border-b p-2">
        <Input
          ref={filterRef}
          value={filterText}
          onChange={(e) => {
            setFilterText(e.target.value);
            // Clearing the box returns to filtering the loaded pages.
            if (!e.target.value.trim()) setSearchMode(false);
          }}
          placeholder="Filter loaded commits, or search all history"
          className="h-7"
          autoComplete="off"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                onKeyDown={onListKeyDown}
                onContextMenuCapture={handleCommitContextMenu}
              />
            }
          >
            {visibleCommits.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {searchActive
                  ? search.isFetching
                    ? "Searching all history…"
                    : `No commits match "${filterText.trim()}"`
                  : "No loaded commits match the filter"}
              </p>
            )}
            {visibleCommits.map((commit, index) => (
              <button
                key={commit.hash}
                type="button"
                data-hash={commit.hash}
                className={cn(
                  "block w-full border-b px-3 py-2 text-left",
                  selected.has(commit.hash) ||
                    (selected.size === 0 && selectedCommitHash === commit.hash)
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/60",
                )}
                onClick={(e) => onRowClick(e, index, commit.hash)}
                onMouseEnter={() =>
                  hoverPrefetch(() => prefetchCommit(commit.hash))
                }
              >
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <span className="min-w-0 truncate" title={commit.subject}>
                    {commit.subject}
                  </span>
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
                  {unpushedHashes.has(commit.hash) && (
                    <span
                      className="ml-auto flex shrink-0 items-center text-muted-foreground"
                      title={
                        head?.upstream
                          ? `Not pushed yet — ahead of ${head.upstream}`
                          : "Not pushed yet"
                      }
                      aria-label="Not pushed yet"
                    >
                      <ArrowUpIcon className="size-3" weight="bold" />
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
            ))}
            {searchActive ? (
              <div className="space-y-0.5 px-3 py-2 text-center">
                {search.hasNextPage && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    disabled={search.isFetchingNextPage}
                    onClick={() => search.fetchNextPage()}
                  >
                    {search.isFetchingNextPage && (
                      <Spinner data-icon="inline-start" />
                    )}
                    Load more results
                  </Button>
                )}
                <div>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={() => setSearchMode(false)}
                  >
                    Back to recent history
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {query && (
                  <div className="px-3 py-2 text-center">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-primary"
                      onClick={() => setSearchMode(true)}
                    >
                      <MagnifyingGlassIcon data-icon="inline-start" />
                      Search all history for "{filterText.trim()}"
                    </Button>
                  </div>
                )}
                {log.hasNextPage && (
                  <div className="px-3 py-2 text-center">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground"
                      disabled={log.isFetchingNextPage}
                      onClick={() => log.fetchNextPage()}
                    >
                      {log.isFetchingNextPage && (
                        <Spinner data-icon="inline-start" />
                      )}
                      Load more ({commits.length} loaded)
                    </Button>
                  </div>
                )}
              </>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-60">
            {renderCommitMenu()}
          </ContextMenuContent>
        </ContextMenu>
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

      <DeleteTagDialog
        repoPath={repoPath}
        name={deleteTagName}
        remote={deleteTagRemote}
        onRemoteChange={setDeleteTagRemote}
        onClose={() => setDeleteTagName(null)}
      />

      <ResetCommitDialog
        repoPath={repoPath}
        hash={resetHash}
        onClose={() => setResetHash(null)}
      />

      <CreateRefFromCommitDialog
        form={branchForm}
        open={branchHash !== null}
        onClose={() => setBranchHash(null)}
        title="Create branch from commit"
        description={`Creates a branch starting at ${branchHash?.slice(0, 7) ?? ""} and switches to it.`}
        fieldLabel="Branch name"
        placeholder="feature/from-commit"
        submitLabel="Create branch"
      />

      <CreateRefFromCommitDialog
        form={tagForm}
        open={tagHash !== null}
        onClose={() => setTagHash(null)}
        title="Create tag"
        description={`Tags commit ${tagHash?.slice(0, 7) ?? ""}.`}
        fieldLabel="Tag name"
        placeholder="v1.0.0"
        submitLabel="Create tag"
      />

      <CherryPickOntoDialog
        repoPath={repoPath}
        hashes={pickOntoHashes}
        branch={pickOntoBranch}
        onBranchChange={setPickOntoBranch}
        branches={targetBranches}
        currentBranch={currentBranch}
        onClose={() => setPickOntoHashes(null)}
        onDone={() => setSelected(new Set())}
      />
    </>
  );
}
