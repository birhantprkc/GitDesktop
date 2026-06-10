import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useRepoStatus, useStage, useUnstage } from "@/lib/git/queries";
import type { FileEntry } from "@/lib/git/types";
import { useUiStore } from "@/lib/stores/ui";
import { errorMessage } from "@/lib/tauri/invoke";
import { FileRow } from "./FileRow";

/**
 * A staged rename is "delete old path + add new path"; restoring only the
 * new path would leave the old path's deletion staged, so include both.
 */
function unstagePaths(entry: FileEntry): string[] {
  return entry.origPath ? [entry.path, entry.origPath] : [entry.path];
}

export function ChangesPanel({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const stage = useStage(repoPath);
  const unstage = useUnstage(repoPath);
  const selectedFile = useUiStore((s) => s.selectedFile);
  const selectFile = useUiStore((s) => s.selectFile);

  const entries = status.data?.entries ?? [];
  const unstagedEntries = entries.filter((e) => e.unstaged !== null);
  const stagedEntries = entries.filter((e) => e.staged !== null);

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
  const onError = (e: unknown) => toast.error(errorMessage(e));

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
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-2">
        {entries.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            No local changes
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
                selected={
                  selectedFile?.path === entry.path &&
                  selectedFile.staged === false
                }
                onSelect={() => select(entry, false)}
                onToggle={() => stage.mutate([entry.path], { onError })}
              />
            ))}
          </section>
        )}
      </div>
    </ScrollArea>
  );
}
