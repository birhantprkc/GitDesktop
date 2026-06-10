import { CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffSurface } from "@/features/diff/DiffSurface";
import {
  useCommitDetails,
  useCommitFileDiff,
  useCommitFiles,
} from "@/lib/git/queries";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export function CommitDetailView({
  repoPath,
  hash,
}: {
  repoPath: string;
  hash: string;
}) {
  const details = useCommitDetails(repoPath, hash);
  const files = useCommitFiles(repoPath, hash);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const diff = useCommitFileDiff(repoPath, hash, selectedPath);

  // Auto-select the first file whenever a different commit is shown.
  useEffect(() => {
    setSelectedPath(files.data?.[0]?.path ?? null);
  }, [files.data]);

  if (details.isPending || files.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (details.isError || files.isError) {
    return <DiffPlaceholder message="Could not load this commit" />;
  }

  const commit = details.data;
  const totalAdded = files.data.reduce((sum, f) => sum + f.added, 0);
  const totalDeleted = files.data.reduce((sum, f) => sum + f.deleted, 0);

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(commit.hash);
      toast.success("Commit hash copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-1 border-b px-4 py-3">
        <h2 className="text-sm font-medium">{commit.subject}</h2>
        {commit.body && (
          <p className="max-h-24 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground">
            {commit.body}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9px] uppercase">
            {commit.author.slice(0, 1)}
          </span>
          <span>{commit.author}</span>
          <span>•</span>
          <span>{formatRelativeTime(commit.date)}</span>
          <span>•</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-mono hover:text-foreground"
            onClick={copyHash}
            title="Copy full hash"
          >
            {commit.hash.slice(0, 7)}
            <CopyIcon className="size-3" />
          </button>
          <span className="flex-1" />
          <span className="text-green-600 dark:text-green-400">
            +{totalAdded}
          </span>
          <span className="text-red-600 dark:text-red-400">
            -{totalDeleted}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r">
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
            {files.data.length} changed file{files.data.length === 1 ? "" : "s"}
          </p>
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
