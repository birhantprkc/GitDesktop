import { Popover } from "@base-ui/react/popover";
import {
  ArrowSquareOutIcon,
  ClockCounterClockwiseIcon,
  FunnelIcon,
  GitPullRequestIcon,
  PencilSimpleIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ghRepoUrl, openInTerminal, openWithProgram } from "@/lib/git/api";
import {
  useCompareBranches,
  useDefaultBranch,
  useDiscard,
  useGhStatus,
  useRepoStatus,
  useStage,
  useUnstage,
} from "@/lib/git/queries";
import type { ChangeKind, FileEntry } from "@/lib/git/types";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { FileRow } from "./FileRow";

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

export function ChangesPanel({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const stage = useStage(repoPath);
  const unstage = useUnstage(repoPath);
  const discard = useDiscard(repoPath);
  const selectedFile = useUiStore((s) => s.selectedFile);
  const selectFile = useUiStore((s) => s.selectFile);
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  const setCompareBranch = useUiStore((s) => s.setCompareBranch);
  const settings = useSettings();
  const editorPath = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || "editor";
  const [discardTarget, setDiscardTarget] = useState<FileEntry | null>(null);
  const [filterText, setFilterText] = useState("");
  const [activeKinds, setActiveKinds] = useState<Set<FilterKind>>(new Set());

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

  function stageAll() {
    stage.mutate(
      unstagedEntries.map((e) => e.path),
      { onError },
    );
  }

  function unstageAll() {
    unstage.mutate(stagedEntries.flatMap(unstagePaths), { onError });
  }

  if (status.isPending) {
    return (
      <div className="flex-1 space-y-2 p-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter"
              className="h-7 flex-1"
            />
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
              {nothingMatches && (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                  No files match the filter
                </p>
              )}

              {stagedEntries.length > 0 && (
                <section className="mb-3">
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
                  {stagedEntries.map((entry) => (
                    <FileRow
                      key={`staged:${entry.path}`}
                      entry={entry}
                      kind={entry.staged ?? "modified"}
                      staged
                      disabled={mutating}
                      repoPath={repoPath}
                      selected={
                        selectedFile?.path === entry.path &&
                        selectedFile.staged === true
                      }
                      onSelect={() => select(entry, true)}
                      onToggle={() =>
                        unstage.mutate(unstagePaths(entry), { onError })
                      }
                    />
                  ))}
                </section>
              )}

              {unstagedEntries.length > 0 && (
                <section>
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
                  {unstagedEntries.map((entry) => (
                    <FileRow
                      key={`unstaged:${entry.path}`}
                      entry={entry}
                      kind={entry.unstaged ?? "modified"}
                      staged={false}
                      disabled={mutating}
                      repoPath={repoPath}
                      selected={
                        selectedFile?.path === entry.path &&
                        selectedFile.staged === false
                      }
                      onSelect={() => select(entry, false)}
                      onToggle={() => stage.mutate([entry.path], { onError })}
                      onDiscard={() => setDiscardTarget(entry)}
                    />
                  ))}
                </section>
              )}
            </div>
          </ScrollArea>
        </>
      )}

      <Dialog
        open={discardTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>
              {discardTarget?.unstaged === "untracked"
                ? `${discardTarget.path} is untracked — it will be moved to the recycle bin.`
                : `Unstaged changes to ${discardTarget?.path} will be restored to the last committed version. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={discard.isPending}
              onClick={() => {
                if (!discardTarget) return;
                discard.mutate(
                  {
                    path: discardTarget.path,
                    untracked: discardTarget.unstaged === "untracked",
                  },
                  {
                    onSuccess: () => {
                      toast.success(
                        `Discarded changes to ${discardTarget.path}`,
                      );
                      setDiscardTarget(null);
                    },
                    onError: (e) => {
                      toastError(e);
                      setDiscardTarget(null);
                    },
                  },
                );
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
