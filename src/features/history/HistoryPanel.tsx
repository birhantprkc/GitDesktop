import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useLog } from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export function HistoryPanel({ repoPath }: { repoPath: string }) {
  const log = useLog(repoPath);
  const selectedCommitHash = useUiStore((s) => s.selectedCommitHash);
  const selectCommit = useUiStore((s) => s.selectCommit);

  if (log.isPending) {
    return (
      <div className="flex-1 space-y-3 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const commits = log.data ?? [];
  if (commits.length === 0) {
    return (
      <p className="flex-1 px-2 py-8 text-center text-xs text-muted-foreground">
        No commits yet
      </p>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div>
        {commits.map((commit) => (
          <button
            type="button"
            key={commit.hash}
            className={cn(
              "block w-full border-b px-3 py-2 text-left",
              selectedCommitHash === commit.hash
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted/60",
            )}
            onClick={() => selectCommit(commit.hash)}
          >
            <p className="truncate text-xs font-medium">{commit.subject}</p>
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
        {commits.length >= 200 && (
          <p className="px-3 py-2 text-center text-[11px] text-muted-foreground">
            Showing the latest 200 commits
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
