import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffSurface } from "@/features/diff/DiffSurface";
import { useBranchDiffFiles, useBranchFileDiff } from "@/lib/git/queries";
import { cn } from "@/lib/utils";

/**
 * The net change `compare` introduces relative to `base` (the three-dot diff,
 * what a PR would show): a changed-file list plus the selected file's diff.
 */
export function BranchDiffView({
  repoPath,
  base,
  compare,
}: {
  repoPath: string;
  base: string;
  compare: string;
}) {
  const files = useBranchDiffFiles(repoPath, base, compare);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const diff = useBranchFileDiff(repoPath, base, compare, selectedPath);

  // Reset the selected file when the comparison changes.
  useEffect(() => {
    setSelectedPath(files.data?.[0]?.path ?? null);
  }, [files.data]);

  if (files.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (files.isError) {
    return <DiffPlaceholder message="Could not compare these branches" />;
  }
  if (files.data.length === 0) {
    return (
      <DiffPlaceholder
        message={`${compare} has no changes relative to ${base}`}
      />
    );
  }

  const totalAdded = files.data.reduce((sum, f) => sum + f.added, 0);
  const totalDeleted = files.data.reduce((sum, f) => sum + f.deleted, 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3 text-xs">
        <span className="font-medium">
          <span className="font-mono">{compare}</span> vs{" "}
          <span className="font-mono">{base}</span>
        </span>
        <span className="flex-1" />
        <span className="text-muted-foreground">
          {files.data.length} file{files.data.length === 1 ? "" : "s"}
        </span>
        <span className="text-green-600 dark:text-green-400">
          +{totalAdded}
        </span>
        <span className="text-red-600 dark:text-red-400">-{totalDeleted}</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r">
          <ScrollArea className="min-h-0 flex-1">
            {files.data.map((file) => (
              <button
                type="button"
                key={file.path}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                  selectedPath === file.path
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
          </ScrollArea>
        </aside>
        <main className="min-w-0 flex-1">
          {selectedPath ? (
            <DiffSurface filePath={selectedPath} diff={diff} />
          ) : (
            <DiffPlaceholder message="Select a file to see its changes" />
          )}
        </main>
      </div>
    </div>
  );
}
