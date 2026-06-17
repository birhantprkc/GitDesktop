import { TrashIcon } from "@phosphor-icons/react";
import { useDeferredValue, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffSurface } from "@/features/diff/DiffSurface";
import type { ImageRevs } from "@/features/diff/ImageDiff";
import {
  useStashApply,
  useStashDrop,
  useStashFileDiff,
  useStashFiles,
  useStashList,
} from "@/lib/git/queries";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Browse the stash stack: pick a stash, see the files it holds, inspect each
 * one's diff, then apply, pop, or drop it.
 */
export function StashesDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stashes = useStashList(repoPath, open);
  const apply = useStashApply(repoPath);
  const drop = useStashDrop(repoPath);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null);

  const list = stashes.data ?? [];
  // Default to the newest stash; fall back when the selected one is gone.
  const effectiveIndex =
    selectedIndex !== null && list.some((s) => s.index === selectedIndex)
      ? selectedIndex
      : (list[0]?.index ?? null);
  const busy = apply.isPending || drop.isPending;
  const onError = (e: unknown) => toastError(e);

  function applyStash(index: number, pop: boolean) {
    apply.mutate(
      { index, pop },
      {
        onSuccess: () =>
          toast.success(pop ? "Stash applied and dropped" : "Stash applied"),
        onError,
      },
    );
  }

  // Arrow keys walk the stash list, mirroring the app's other lists.
  const onStashesKeyDown = listKeyboardNav({
    items: list,
    activeIndex: list.findIndex((s) => s.index === effectiveIndex),
    onActivate: (stash) => setSelectedIndex(stash.index),
    rowKey: (stash) => String(stash.index),
    rowAttr: "data-stash",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Stashes</DialogTitle>
          <DialogDescription>
            Changes set aside with stash. Apply re-applies a stash to the
            working tree; pop also removes it from the stack.
          </DialogDescription>
        </DialogHeader>
        {list.length === 0 ? (
          <p className="flex-1 py-8 text-center text-xs text-muted-foreground">
            No stashes. "Stash all changes" in the branch menu sets the working
            tree aside here.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 border">
            <aside className="flex w-56 shrink-0 flex-col border-r">
              <ScrollArea className="min-h-0 flex-1">
                <div onKeyDown={onStashesKeyDown}>
                  {list.map((stash) => (
                    <button
                      type="button"
                      key={stash.index}
                      data-stash={stash.index}
                      className={cn(
                        "block w-full border-b px-3 py-2 text-left",
                        effectiveIndex === stash.index
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted/60",
                      )}
                      onClick={() => setSelectedIndex(stash.index)}
                    >
                      <p className="truncate text-xs font-medium">
                        {stash.message}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        stash@{"{"}
                        {stash.index}
                        {"}"} · {formatRelativeTime(stash.date)}
                      </p>
                    </button>
                  ))}
                </div>
              </ScrollArea>
              {effectiveIndex !== null && (
                <div className="flex items-center gap-1.5 border-t p-2">
                  {busy && <Spinner className="size-3" />}
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    aria-label="Drop stash"
                    disabled={busy}
                    onClick={() => setConfirmDrop(effectiveIndex)}
                  >
                    <TrashIcon data-icon="inline-start" />
                    Drop…
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() => applyStash(effectiveIndex, false)}
                  >
                    Apply
                  </Button>
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() => applyStash(effectiveIndex, true)}
                  >
                    Pop
                  </Button>
                </div>
              )}
            </aside>
            {effectiveIndex !== null ? (
              <StashFiles
                key={effectiveIndex}
                repoPath={repoPath}
                index={effectiveIndex}
              />
            ) : null}
          </div>
        )}

        <Dialog
          open={confirmDrop !== null}
          onOpenChange={(o) => {
            if (!o) setConfirmDrop(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Drop this stash?</DialogTitle>
              <DialogDescription>
                Permanently deletes stash@{"{"}
                {confirmDrop}
                {"}"} and the changes it holds. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDrop(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={drop.isPending}
                onClick={() => {
                  if (confirmDrop === null) return;
                  drop.mutate(confirmDrop, {
                    onSuccess: () => {
                      setConfirmDrop(null);
                      toast.success("Stash dropped");
                    },
                    onError: (e) => {
                      setConfirmDrop(null);
                      onError(e);
                    },
                  });
                }}
              >
                {drop.isPending && <Spinner data-icon="inline-start" />}
                Drop stash
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/** File list + selected file diff for one stash. */
function StashFiles({ repoPath, index }: { repoPath: string; index: number }) {
  const files = useStashFiles(repoPath, index);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const effectivePath =
    selectedPath && files.data?.some((f) => f.path === selectedPath)
      ? selectedPath
      : (files.data?.[0]?.path ?? null);
  // Diff off a deferred path so rapid file arrowing only fetches the landed-on
  // file; the highlight stays on effectivePath.
  const deferredPath = useDeferredValue(effectivePath);
  const diff = useStashFileDiff(repoPath, index, deferredPath);

  // Image/SVG previews need the file's content on each side. Tracked changes
  // read from the stash commit; untracked files from its ^3 parent.
  const effectiveFile = files.data?.find((f) => f.path === deferredPath);
  const imageRevs: ImageRevs | undefined = effectiveFile
    ? {
        old: `stash@{${index}}^1`,
        new: effectiveFile.untracked
          ? `stash@{${index}}^3`
          : `stash@{${index}}`,
      }
    : undefined;

  if (files.isPending) {
    return null;
  }
  if (files.isError || !files.data) {
    return (
      <div className="flex-1">
        <DiffPlaceholder message="Could not load this stash" />
      </div>
    );
  }

  const fileList = files.data;
  // Arrow keys walk the file list, mirroring the app's other lists.
  const onFilesKeyDown = listKeyboardNav({
    items: fileList,
    activeIndex: fileList.findIndex((f) => f.path === effectivePath),
    onActivate: (file) => setSelectedPath(file.path),
    rowKey: (file) => file.path,
    rowAttr: "data-path",
  });

  return (
    <>
      <aside className="flex w-60 shrink-0 flex-col border-r">
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
          {fileList.length} changed file{fileList.length === 1 ? "" : "s"}
        </p>
        <ScrollArea className="min-h-0 flex-1">
          <div onKeyDown={onFilesKeyDown}>
            {fileList.map((file) => (
              <button
                type="button"
                key={file.path}
                data-path={file.path}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                  effectivePath === file.path
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/60",
                )}
                onClick={() => setSelectedPath(file.path)}
                title={file.path}
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  {file.path}
                </span>
                {file.isBinary ? (
                  <span className="shrink-0 text-muted-foreground">bin</span>
                ) : (
                  <span className="shrink-0 tabular-nums">
                    <span className="text-green-600 dark:text-green-400">
                      +{file.added}
                    </span>{" "}
                    <span className="text-red-600 dark:text-red-400">
                      -{file.deleted}
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>
      <main className="min-w-0 flex-1">
        {deferredPath ? (
          <DiffSurface
            filePath={deferredPath}
            diff={diff}
            repoPath={repoPath}
            imageRevs={imageRevs}
          />
        ) : (
          <DiffPlaceholder message="This stash has no files" />
        )}
      </main>
    </>
  );
}
