import { Popover } from "@base-ui/react/popover";
import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  FunnelIcon,
  GitPullRequestIcon,
  InfoIcon,
  PencilSimpleIcon,
  StackIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { BlameDialog } from "@/features/history/BlameDialog";
import { FileHistoryDialog } from "@/features/history/FileHistoryDialog";
import { ghRepoUrl, openInTerminal, openWithProgram } from "@/lib/git/api";
import {
  useCompareBranches,
  useDefaultBranch,
  useDiscardAll,
  useDiscardPaths,
  useGhStatus,
  useRepoStatus,
  useStage,
  useStashAll,
  useStashCount,
  useStashPaths,
  useUnstage,
} from "@/lib/git/queries";
import type { ChangeKind, FileEntry } from "@/lib/git/types";
import { isMac } from "@/lib/hotkeys/binding";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { ConflictBanner } from "./ConflictBanner";
import { FileRow } from "./FileRow";
import { StashesDialog } from "./StashesDialog";

/**
 * A staged rename is "delete old path + add new path"; restoring only the
 * new path would leave the old path's deletion staged, so include both.
 */
function unstagePaths(entry: FileEntry): string[] {
  return entry.origPath ? [entry.path, entry.origPath] : [entry.path];
}

type FilterKind = "included" | "excluded" | "new" | "modified" | "deleted";

function hasKind(entry: FileEntry, kinds: ChangeKind[]): boolean {
  return [entry.staged, entry.unstaged].some(
    (k) => k !== null && kinds.includes(k),
  );
}

const FILTER_PREDICATES: Record<FilterKind, (e: FileEntry) => boolean> = {
  included: (e) => e.staged !== null,
  excluded: (e) => e.unstaged !== null,
  new: (e) => hasKind(e, ["added", "untracked"]),
  modified: (e) => hasKind(e, ["modified"]),
  deleted: (e) => hasKind(e, ["deleted"]),
};

const FILTER_LABELS: Record<FilterKind, string> = {
  included: "Included in commit",
  excluded: "Excluded from commit",
  new: "New files",
  modified: "Modified files",
  deleted: "Deleted files",
};

/** Target of a discard/stash confirm dialog: specific files (one row or a
 *  multi-selection) or the whole working tree. Null = no dialog open. */
type ChangeActionScope =
  | { kind: "files"; entries: FileEntry[] }
  | { kind: "all" }
  | null;

/** Right-click wrapper for a section header, exposing the whole-tree
 *  "Discard all" / "Stash all" actions. */
function SectionHeaderMenu({
  header,
  onDiscardAll,
  onStashAll,
}: {
  header: React.ReactElement;
  onDiscardAll: () => void;
  onStashAll: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={header} />
      <ContextMenuContent className="min-w-56">
        <ContextMenuItem onClick={onDiscardAll}>
          Discard all changes…
        </ContextMenuItem>
        <ContextMenuItem onClick={onStashAll}>
          Stash all changes…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ChangesPanel({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const stage = useStage(repoPath);
  const unstage = useUnstage(repoPath);
  const discardPaths = useDiscardPaths(repoPath);
  const discardAll = useDiscardAll(repoPath);
  const stashPaths = useStashPaths(repoPath);
  const stashAll = useStashAll(repoPath);
  const selectedFile = useUiStore((s) => s.selectedFile);
  const selectFile = useUiStore((s) => s.selectFile);
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  const setCompareBranch = useUiStore((s) => s.setCompareBranch);
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const editorPath = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || "editor";
  const stashCount = useStashCount(repoPath);
  // A confirm dialog is open when its scope is non-null. "files" covers a
  // single right-clicked row and a multi-selection alike (1+ entries); "all"
  // is the whole working tree (from the section-header menu).
  const [discardScope, setDiscardScope] = useState<ChangeActionScope>(null);
  const [stashScope, setStashScope] = useState<ChangeActionScope>(null);
  // Multi-selection for bulk stash/discard, keyed like the rendered rows
  // ("staged:path" / "unstaged:path"). `selectedFile` stays the active row
  // whose diff is shown; `anchorKey` is the pivot for shift-range selection.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [activeKinds, setActiveKinds] = useState<Set<FilterKind>>(new Set());
  const [stashesOpen, setStashesOpen] = useState(false);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const [blamePath, setBlamePath] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const entries = status.data?.entries ?? [];

  // Empty-state suggestions: a published repo offers "View on GitHub"; a
  // branch with commits the default branch doesn't have offers a PR. The
  // comparison only runs while the tree is clean, so the daily loop never
  // pays for it.
  const gh = useGhStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const defaultBranch = useDefaultBranch(repoPath);
  const branch = status.data?.branch;
  const currentName = branch?.name ?? null;
  const defaultName = defaultBranch.data ?? null;
  const treeClean = !status.isPending && entries.length === 0;
  const canCompareDefault =
    treeClean &&
    !branch?.detached &&
    currentName !== null &&
    defaultName !== null &&
    currentName !== defaultName;
  const aheadOfDefault = useCompareBranches(
    repoPath,
    canCompareDefault ? defaultName : null,
    canCompareDefault ? currentName : null,
  );
  const proposeCount = canCompareDefault
    ? (aheadOfDefault.data?.ahead.length ?? 0)
    : 0;

  const text = filterText.trim().toLowerCase();
  function visible(entry: FileEntry): boolean {
    if (text && !entry.path.toLowerCase().includes(text)) return false;
    if (activeKinds.size === 0) return true;
    return [...activeKinds].some((k) => FILTER_PREDICATES[k](entry));
  }

  const unstagedEntries = entries.filter(
    (e) => e.unstaged !== null && visible(e),
  );
  const stagedEntries = entries.filter((e) => e.staged !== null && visible(e));
  const nothingMatches =
    entries.length > 0 &&
    stagedEntries.length === 0 &&
    unstagedEntries.length === 0;

  // The rows in render order, so ArrowUp/Down can walk the selection
  // across both sections.
  const visibleRows = [
    ...stagedEntries.map((entry) => ({ entry, staged: true })),
    ...unstagedEntries.map((entry) => ({ entry, staged: false })),
  ];
  const keyOf = (path: string, staged: boolean) =>
    `${staged ? "staged" : "unstaged"}:${path}`;
  const activeKey = selectedFile
    ? keyOf(selectedFile.path, selectedFile.staged)
    : null;
  // Entries behind the multi-selection (deduped to one per path), driving the
  // bulk context menu and its confirm dialogs.
  const selectedPaths = new Set(
    [...selectedKeys].map((k) => k.slice(k.indexOf(":") + 1)),
  );
  const selectedEntries = entries.filter((e) => selectedPaths.has(e.path));
  const selectionCount = selectedEntries.length;

  // Arrow keys walk the rows across both sections; Shift extends from the
  // anchor, a plain arrow collapses to the single active row.
  const rowKey = (r: { entry: FileEntry; staged: boolean }) =>
    keyOf(r.entry.path, r.staged);
  const onListKeyDown = listKeyboardNav({
    items: visibleRows,
    activeIndex: activeKey
      ? visibleRows.findIndex((r) => rowKey(r) === activeKey)
      : -1,
    rowKey,
    onActivate: (row, to, shift) => {
      const key = rowKey(row);
      select(row.entry, row.staged);
      if (shift && anchorKey) {
        const keys = visibleRows.map(rowKey);
        const a = keys.indexOf(anchorKey);
        if (a !== -1) {
          const [lo, hi] = a <= to ? [a, to] : [to, a];
          setSelectedKeys(new Set(keys.slice(lo, hi + 1)));
        }
      } else {
        setSelectedKeys(new Set([key]));
        setAnchorKey(key);
      }
    },
  });

  // Drop the selection when the selected file leaves its section
  // (e.g. it was staged, committed, or reverted externally).
  useEffect(() => {
    if (!selectedFile || !status.data) return;
    const stillThere = status.data.entries.some(
      (e) =>
        e.path === selectedFile.path &&
        (selectedFile.staged ? e.staged !== null : e.unstaged !== null),
    );
    if (!stillThere) selectFile(null);
  }, [status.data, selectedFile, selectFile]);
  // Prune multi-selection keys for files that have left the working tree
  // (committed, discarded, etc.) so counts and highlights stay accurate.
  useEffect(() => {
    if (!status.data) return;
    const paths = new Set(status.data.entries.map((e) => e.path));
    setSelectedKeys((prev) => {
      const next = new Set(
        [...prev].filter((k) => paths.has(k.slice(k.indexOf(":") + 1))),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [status.data]);
  const mutating = stage.isPending || unstage.isPending;
  const onError = (e: unknown) => toastError(e);

  function toggleKind(kind: FilterKind, on: boolean) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (on) next.add(kind);
      else next.delete(kind);
      return next;
    });
  }

  function select(entry: FileEntry, staged: boolean) {
    selectFile({
      path: entry.path,
      staged,
      untracked: entry.unstaged === "untracked",
    });
  }

  // Click selection with modifier support: plain = single, Ctrl/Cmd = toggle,
  // Shift = range from the anchor. The clicked row always becomes active so
  // its diff shows (via `select`).
  function handleSelect(
    entry: FileEntry,
    staged: boolean,
    mods: { ctrlOrMeta: boolean; shift: boolean },
  ) {
    const key = keyOf(entry.path, staged);
    select(entry, staged);
    if (mods.shift && anchorKey) {
      const keys = visibleRows.map((r) => keyOf(r.entry.path, r.staged));
      const a = keys.indexOf(anchorKey);
      const b = keys.indexOf(key);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelectedKeys(new Set(keys.slice(lo, hi + 1)));
        return;
      }
    }
    if (mods.ctrlOrMeta) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setAnchorKey(key);
      return;
    }
    setSelectedKeys(new Set([key]));
    setAnchorKey(key);
  }

  function stageAll() {
    stage.mutate(
      unstagedEntries.map((e) => e.path),
      { onError },
    );
  }

  function unstageAll() {
    unstage.mutate(stagedEntries.flatMap(unstagePaths), { onError });
  }

  // Bulk stage/unstage of the selection. Direction comes from the section the
  // row was right-clicked in; re-staging an already-staged path (or vice versa)
  // is a harmless git no-op, so every selected file ends up in that state.
  function stageSelected() {
    if (selectionCount === 0) return;
    stage.mutate(
      selectedEntries.map((e) => e.path),
      { onError, onSuccess: () => setSelectedKeys(new Set()) },
    );
  }

  function unstageSelected() {
    if (selectionCount === 0) return;
    unstage.mutate(selectedEntries.flatMap(unstagePaths), {
      onError,
      onSuccess: () => setSelectedKeys(new Set()),
    });
  }

  function requestDiscardSelected() {
    if (selectionCount > 0)
      setDiscardScope({ kind: "files", entries: selectedEntries });
  }

  function requestStashSelected() {
    if (selectionCount > 0)
      setStashScope({ kind: "files", entries: selectedEntries });
  }

  function confirmDiscard() {
    if (!discardScope) return;
    const finish = () => {
      setDiscardScope(null);
      setSelectedKeys(new Set());
    };
    if (discardScope.kind === "all") {
      discardAll.mutate(undefined, {
        onSuccess: () => {
          toast.success("All changes discarded");
          finish();
        },
        onError: (e) => {
          onError(e);
          finish();
        },
      });
      return;
    }
    const targets = discardScope.entries.map((e) => ({
      path: e.path,
      untracked: e.unstaged === "untracked",
    }));
    discardPaths.mutate(targets, {
      onSuccess: () => {
        toast.success(
          targets.length === 1
            ? `Discarded changes to ${targets[0].path}`
            : `Discarded changes to ${targets.length} files`,
        );
        finish();
      },
      onError: (e) => {
        onError(e);
        finish();
      },
    });
  }

  function confirmStash() {
    if (!stashScope) return;
    const finish = () => {
      setStashScope(null);
      setSelectedKeys(new Set());
    };
    if (stashScope.kind === "all") {
      stashAll.mutate(undefined, {
        onSuccess: () => {
          toast.success("Changes stashed");
          finish();
        },
        onError: (e) => {
          onError(e);
          finish();
        },
      });
      return;
    }
    const targets = stashScope.entries.map((e) => e.path);
    stashPaths.mutate(targets, {
      onSuccess: () => {
        toast.success(
          targets.length === 1
            ? `Stashed ${targets[0]}`
            : `Stashed ${targets.length} files`,
        );
        finish();
      },
      onError: (e) => {
        onError(e);
        finish();
      },
    });
  }

  useHotkeyAction(
    "stage-all",
    stageAll,
    !mutating && unstagedEntries.length > 0,
  );
  useHotkeyAction(
    "unstage-all",
    unstageAll,
    !mutating && stagedEntries.length > 0,
  );
  useHotkeyAction(
    "focus-filter",
    () => filterRef.current?.focus(),
    entries.length > 0,
  );

  if (status.isPending) {
    return (
      <div className="flex-1 space-y-2 p-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const conflictedCount = entries.filter(
    (e) => e.unstaged === "conflicted" || e.staged === "conflicted",
  ).length;

  // Confirm-dialog copy, derived from each action's scope (a single file, a
  // multi-selection, or the whole tree).
  const discardFiles =
    discardScope?.kind === "files" ? discardScope.entries : [];
  const discardOne = discardFiles.length === 1 ? discardFiles[0] : null;
  const discardTitle =
    discardScope?.kind === "all"
      ? "Discard all changes?"
      : discardOne
        ? "Discard changes?"
        : `Discard ${discardFiles.length} changes?`;
  const discardBody =
    discardScope?.kind === "all"
      ? "All uncommitted changes are discarded: tracked files reset to the last commit, untracked files move to the recycle bin."
      : discardOne
        ? discardOne.unstaged === "untracked"
          ? `${discardOne.path} is untracked — it will be moved to the recycle bin.`
          : `Unstaged changes to ${discardOne.path} will be restored to the last committed version. This cannot be undone.`
        : `Changes to ${discardFiles.length} files will be discarded — tracked files are restored and untracked files moved to the recycle bin. This cannot be undone.`;

  const stashFiles = stashScope?.kind === "files" ? stashScope.entries : [];
  const stashOne = stashFiles.length === 1 ? stashFiles[0] : null;
  const stashTitle =
    stashScope?.kind === "all"
      ? "Stash all changes?"
      : stashOne
        ? "Stash change?"
        : `Stash ${stashFiles.length} changes?`;
  const stashBody =
    stashScope?.kind === "all"
      ? 'Sets your working tree back to the last commit and saves all uncommitted changes — including untracked files — to the stash. "Pop latest stash" restores them.'
      : stashOne
        ? `${stashOne.path} is saved to the stash and removed from your working tree. "Pop latest stash" restores it.`
        : `${stashFiles.length} selected files are saved to the stash and removed from your working tree. "Pop latest stash" restores them.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ConflictBanner repoPath={repoPath} conflictedCount={conflictedCount} />
      {entries.length === 0 ? (
        <div className="flex-1 px-4 py-8 text-center">
          <p className="text-xs font-medium">No local changes</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your working tree is clean.
          </p>
          <div className="mx-auto mt-4 flex max-w-60 flex-col gap-2">
            {proposeCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCompareBranch(defaultName);
                  setRepoTab("compare");
                }}
                title={`${currentName} is ${proposeCount} commit${
                  proposeCount === 1 ? "" : "s"
                } ahead of ${defaultName}`}
              >
                <GitPullRequestIcon data-icon="inline-start" />
                Open pull request
              </Button>
            )}
            {ghReady && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  ghRepoUrl(repoPath)
                    .then((url) => openUrl(url))
                    .catch(onError)
                }
              >
                <ArrowSquareOutIcon data-icon="inline-start" />
                View on GitHub
              </Button>
            )}
            {editorPath && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  openWithProgram(editorPath, repoPath).catch(onError)
                }
              >
                <PencilSimpleIcon data-icon="inline-start" />
                Open in {editorName}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openInTerminal(
                  repoPath,
                  settings.data?.terminal,
                  settings.data?.terminalPath,
                ).catch(onError)
              }
            >
              <TerminalIcon data-icon="inline-start" />
              Open in terminal
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRepoTab("history")}
            >
              <ClockCounterClockwiseIcon data-icon="inline-start" />
              View history
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 border-b p-2">
            <Popover.Root>
              <Popover.Trigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={
                      activeKinds.size > 0
                        ? `Filter options (${activeKinds.size} active)`
                        : "Filter options"
                    }
                    className="relative"
                  />
                }
              >
                <FunnelIcon />
                {activeKinds.size > 0 && (
                  <span
                    aria-hidden
                    className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center bg-primary text-[9px] font-medium text-primary-foreground tabular-nums"
                  >
                    {activeKinds.size}
                  </span>
                )}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  align="start"
                  sideOffset={4}
                  className="isolate z-50"
                >
                  <Popover.Popup className="w-56 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                    <p className="px-1 pb-1.5 text-xs font-medium">
                      Filter Options
                    </p>
                    {(Object.keys(FILTER_LABELS) as FilterKind[]).map(
                      (kind) => (
                        <label
                          key={kind}
                          className="flex cursor-pointer items-center gap-2 rounded-none px-1 py-1.5 text-xs hover:bg-muted/60"
                        >
                          <Checkbox
                            checked={activeKinds.has(kind)}
                            onCheckedChange={(v) =>
                              toggleKind(kind, v === true)
                            }
                          />
                          <span className="flex-1">{FILTER_LABELS[kind]}</span>
                          <span className="text-muted-foreground">
                            ({entries.filter(FILTER_PREDICATES[kind]).length})
                          </span>
                        </label>
                      ),
                    )}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <Input
              ref={filterRef}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter"
              className="h-7 flex-1"
              autoComplete="off"
            />
          </div>

          {(settings.data?.showSelectionHint ?? true) &&
            entries.length >= 2 && (
              <div className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                <InfoIcon className="size-3.5 shrink-0" />
                <span className="flex-1 leading-snug">
                  {isMac ? "⌘" : "Ctrl"}-click to select files individually,
                  Shift-click for a range.
                </span>
                <button
                  type="button"
                  onClick={() =>
                    settings.data &&
                    saveSettings.mutate({
                      ...settings.data,
                      showSelectionHint: false,
                    })
                  }
                  className="shrink-0 font-medium whitespace-nowrap underline underline-offset-2 hover:no-underline"
                >
                  Don't show again
                </button>
              </div>
            )}

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2" onKeyDown={onListKeyDown}>
              {nothingMatches && (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                  No files match the filter
                </p>
              )}

              {stagedEntries.length > 0 && (
                <section className="mb-3">
                  <SectionHeaderMenu
                    onDiscardAll={() => setDiscardScope({ kind: "all" })}
                    onStashAll={() => setStashScope({ kind: "all" })}
                    header={
                      <div className="flex items-center justify-between pr-1 pl-2">
                        <h3 className="py-1 text-xs font-medium text-muted-foreground">
                          Staged ({stagedEntries.length})
                        </h3>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-muted-foreground"
                          disabled={mutating}
                          onClick={unstageAll}
                        >
                          Unstage all
                        </Button>
                      </div>
                    }
                  />
                  {stagedEntries.map((entry) => (
                    <FileRow
                      key={`staged:${entry.path}`}
                      entry={entry}
                      kind={entry.staged ?? "modified"}
                      staged
                      disabled={mutating}
                      repoPath={repoPath}
                      selected={selectedKeys.has(keyOf(entry.path, true))}
                      active={
                        selectedFile?.path === entry.path &&
                        selectedFile.staged === true
                      }
                      selectionCount={selectionCount}
                      onSelect={(mods) => handleSelect(entry, true, mods)}
                      onToggle={() =>
                        unstage.mutate(unstagePaths(entry), { onError })
                      }
                      onStashFile={() =>
                        setStashScope({ kind: "files", entries: [entry] })
                      }
                      onViewHistory={() => setHistoryPath(entry.path)}
                      onBlame={() => setBlamePath(entry.path)}
                      onStageSelected={stageSelected}
                      onUnstageSelected={unstageSelected}
                      onDiscardSelected={requestDiscardSelected}
                      onStashSelected={requestStashSelected}
                    />
                  ))}
                </section>
              )}

              {unstagedEntries.length > 0 && (
                <section>
                  <SectionHeaderMenu
                    onDiscardAll={() => setDiscardScope({ kind: "all" })}
                    onStashAll={() => setStashScope({ kind: "all" })}
                    header={
                      <div className="flex items-center justify-between pr-1 pl-2">
                        <h3 className="py-1 text-xs font-medium text-muted-foreground">
                          Changes ({unstagedEntries.length})
                        </h3>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-muted-foreground"
                          disabled={mutating}
                          onClick={stageAll}
                        >
                          Stage all
                        </Button>
                      </div>
                    }
                  />
                  {unstagedEntries.map((entry) => (
                    <FileRow
                      key={`unstaged:${entry.path}`}
                      entry={entry}
                      kind={entry.unstaged ?? "modified"}
                      staged={false}
                      disabled={mutating}
                      repoPath={repoPath}
                      selected={selectedKeys.has(keyOf(entry.path, false))}
                      active={
                        selectedFile?.path === entry.path &&
                        selectedFile.staged === false
                      }
                      selectionCount={selectionCount}
                      onSelect={(mods) => handleSelect(entry, false, mods)}
                      onToggle={() => stage.mutate([entry.path], { onError })}
                      onDiscard={() =>
                        setDiscardScope({ kind: "files", entries: [entry] })
                      }
                      onStashFile={() =>
                        setStashScope({ kind: "files", entries: [entry] })
                      }
                      onViewHistory={() => setHistoryPath(entry.path)}
                      onBlame={() => setBlamePath(entry.path)}
                      onStageSelected={stageSelected}
                      onUnstageSelected={unstageSelected}
                      onDiscardSelected={requestDiscardSelected}
                      onStashSelected={requestStashSelected}
                    />
                  ))}
                </section>
              )}
            </div>
          </ScrollArea>
        </>
      )}

      {(stashCount.data ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => setStashesOpen(true)}
          className="flex shrink-0 items-center gap-2 border-t px-3 py-2 text-left text-xs hover:bg-muted/60"
          title="View stashed changes on this branch"
        >
          <StackIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 font-medium">Stashed Changes</span>
          <span className="text-muted-foreground tabular-nums">
            {stashCount.data}
          </span>
          <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}

      <StashesDialog
        repoPath={repoPath}
        open={stashesOpen}
        onOpenChange={setStashesOpen}
      />

      {historyPath && (
        <FileHistoryDialog
          repoPath={repoPath}
          path={historyPath}
          open
          onOpenChange={(o) => {
            if (!o) setHistoryPath(null);
          }}
        />
      )}
      {blamePath && (
        <BlameDialog
          repoPath={repoPath}
          path={blamePath}
          open
          onOpenChange={(o) => {
            if (!o) setBlamePath(null);
          }}
        />
      )}

      <Dialog
        open={discardScope !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardScope(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{discardTitle}</DialogTitle>
            <DialogDescription>{discardBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardScope(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={discardPaths.isPending || discardAll.isPending}
              onClick={confirmDiscard}
            >
              {discardScope?.kind === "all" ? "Discard all" : "Discard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={stashScope !== null}
        onOpenChange={(open) => {
          if (!open) setStashScope(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{stashTitle}</DialogTitle>
            <DialogDescription>{stashBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStashScope(null)}>
              Cancel
            </Button>
            <Button
              disabled={stashPaths.isPending || stashAll.isPending}
              onClick={confirmStash}
            >
              {stashScope?.kind === "all" ? "Stash all" : "Stash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
