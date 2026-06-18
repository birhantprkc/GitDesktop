import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AuthorAvatar,
  hasVisibleBody,
  LabelChip,
  Thread,
} from "@/features/conversations/Thread";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { useIssueDetails } from "@/lib/git/queries";
import { formatRelativeTime } from "@/lib/time";

/**
 * Read view for a GitHub issue: header + description + conversation. Write
 * actions (comment, label, close/reopen, edit) arrive in Phase 1b; this reuses
 * the shared {@link Thread}/{@link LabelChip}/{@link AuthorAvatar} primitives so
 * it stays visually identical to the PR view.
 */
export function RemoteIssueView({
  repoPath,
  number,
}: {
  repoPath: string;
  number: number;
}) {
  const details = useIssueDetails(repoPath, number);
  const issue = details.data;

  if (details.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (details.isError || !issue) {
    return <DiffPlaceholder message="Could not load this issue" />;
  }

  const isOpen = issue.state === "OPEN";
  const comments = issue.comments.filter((c) => hasVisibleBody(c.body));

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="text-sm font-medium">
            {issue.title}{" "}
            <span className="font-normal text-muted-foreground">
              #{issue.number}
            </span>
          </h2>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="xs"
            onClick={() => openUrl(issue.url)}
            title="Open this issue on GitHub"
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            GitHub
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={isOpen ? "default" : "secondary"}>
            {issue.state.toLowerCase()}
          </Badge>
          <AuthorAvatar login={issue.author} />
          <span>{issue.author || "unknown"}</span>
          <span>•</span>
          <span>opened {formatRelativeTime(issue.createdAt)}</span>
          {issue.assignees.length > 0 && (
            <>
              <span>•</span>
              <span>assigned to {issue.assignees.join(", ")}</span>
            </>
          )}
        </div>
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {issue.labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </div>
        )}
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <div className="group space-y-1">
            <p className="flex items-center gap-2 text-xs">
              <AuthorAvatar login={issue.author} />
              <span className="font-medium">{issue.author || "unknown"}</span>
              <span className="text-muted-foreground">
                opened {formatRelativeTime(issue.createdAt)}
              </span>
            </p>
            {hasVisibleBody(issue.body) ? (
              <Markdown>{issue.body}</Markdown>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No description provided.
              </p>
            )}
          </div>
          {comments.map((c) => (
            <Thread key={c.id} thread={c} />
          ))}
          {comments.length === 0 && (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
