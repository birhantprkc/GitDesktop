import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeTime } from "@/lib/time";

/** A commit row, normalized from either git-log (local) or GraphQL (remote). */
export interface CommitRow {
  id: string;
  subject: string;
  shortSha: string;
  author: string;
  date?: string | null;
}

/**
 * The commits tab of a pull request: a scrollable list of commit rows
 * (subject, then short SHA · author · relative time). Shared by the local and
 * remote PR views; each maps its native commit shape to `CommitRow` at the call
 * site so the GraphQL/git field-name divergence stays out of here.
 */
export function CommitsList({
  commits,
  emptyMessage,
}: {
  commits: CommitRow[];
  emptyMessage?: string;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      {commits.map((c) => (
        <div key={c.id} className="border-b px-4 py-2">
          <p className="truncate text-xs font-medium">{c.subject}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{c.shortSha}</span> · {c.author} ·{" "}
            {c.date && formatRelativeTime(c.date)}
          </p>
        </div>
      ))}
      {commits.length === 0 && emptyMessage && (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </ScrollArea>
  );
}
