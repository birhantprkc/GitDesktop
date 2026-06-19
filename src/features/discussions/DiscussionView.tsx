import { ArrowSquareOutIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AuthorAvatar,
  hasVisibleBody,
  Thread,
} from "@/features/conversations/Thread";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { useDiscussionDetails } from "@/lib/git/queries";
import type { PrThreadOut } from "@/lib/git/types";
import { formatRelativeTime } from "@/lib/time";

/** A discussion comment/reply shares the conversation shape minus review state. */
function toThread(c: {
  author: string;
  body: string;
  date: string;
  id: string;
  url?: string;
  viewerDidAuthor: boolean;
  isMinimized: boolean;
  minimizedReason: string;
}): PrThreadOut {
  return {
    author: c.author,
    state: "",
    body: c.body,
    date: c.date,
    id: c.id,
    url: c.url ?? "",
    viewerDidAuthor: c.viewerDidAuthor,
    isMinimized: c.isMinimized,
    minimizedReason: c.minimizedReason,
  };
}

/**
 * Read view for a GitHub Discussion: header + body + the two-level thread
 * (top-level comments, each with its nested replies). Write actions (comment,
 * reply, mark-answer) arrive in Phase 2b.
 */
export function DiscussionView({
  repoPath,
  number,
}: {
  repoPath: string;
  number: number;
}) {
  const details = useDiscussionDetails(repoPath, number);
  const d = details.data;

  if (details.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (details.isError || !d) {
    return <DiffPlaceholder message="Could not load this discussion" />;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="text-sm font-medium">
            {d.title}{" "}
            <span className="font-normal text-muted-foreground">
              #{d.number}
            </span>
          </h2>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="xs"
            onClick={() => openUrl(d.url)}
            title="Open this discussion on GitHub"
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            GitHub
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">
            {d.categoryEmoji ? `${d.categoryEmoji} ` : ""}
            {d.categoryName}
          </Badge>
          {d.isAnswered && <Badge variant="default">answered</Badge>}
          <AuthorAvatar login={d.author} />
          <span>{d.author || "unknown"}</span>
          <span>•</span>
          <span>opened {formatRelativeTime(d.createdAt)}</span>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <div className="group space-y-1">
            <p className="flex items-center gap-2 text-xs">
              <AuthorAvatar login={d.author} />
              <span className="font-medium">{d.author || "unknown"}</span>
              <span className="text-muted-foreground">
                opened {formatRelativeTime(d.createdAt)}
              </span>
            </p>
            {hasVisibleBody(d.body) ? (
              <Markdown>{d.body}</Markdown>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No description provided.
              </p>
            )}
          </div>
          {d.comments.map((c) => (
            <div key={c.id} className="space-y-3">
              <div className="space-y-1">
                {c.isAnswer && (
                  <p className="flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                    <CheckCircleIcon className="size-3.5" weight="fill" />
                    Marked as answer
                  </p>
                )}
                <Thread thread={toThread(c)} />
              </div>
              {c.replies.length > 0 && (
                <div className="space-y-3 border-l pl-4">
                  {c.replies.map((r) => (
                    <Thread key={r.id} thread={toThread(r)} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {d.comments.length === 0 && (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
