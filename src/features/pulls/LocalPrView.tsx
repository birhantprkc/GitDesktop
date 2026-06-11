import {
  CaretDownIcon,
  CheckCircleIcon,
  GitMergeIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { BranchDiffView } from "@/features/compare/BranchDiffView";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import type { MergeStrategy } from "@/lib/git/api";
import { useCompareBranches, useMergeLocalPr } from "@/lib/git/queries";
import {
  useDeleteLocalPr,
  useLocalPrs,
  useSaveLocalPr,
} from "@/lib/pulls/queries";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";

type Section = "conversation" | "commits" | "files";

export function LocalPrView({
  repoPath,
  id,
}: {
  repoPath: string;
  id: string;
}) {
  const prs = useLocalPrs(repoPath);
  const pr = prs.data?.find((p) => p.id === id);
  const save = useSaveLocalPr(repoPath);
  const del = useDeleteLocalPr(repoPath);
  const merge = useMergeLocalPr(repoPath);
  const selectPr = useUiStore((s) => s.selectPr);
  const [section, setSection] = useState<Section>("conversation");
  const [comment, setComment] = useState("");

  const comparison = useCompareBranches(
    repoPath,
    pr?.base ?? null,
    pr?.head ?? null,
  );

  if (!pr) {
    return (
      <DiffPlaceholder message="This local pull request no longer exists" />
    );
  }

  const ahead = comparison.data?.ahead ?? [];
  const canMerge = pr.status === "open" && pr.approved;

  function addComment() {
    if (!pr || !comment.trim()) return;
    save.mutate({
      ...pr,
      comments: [
        ...pr.comments,
        {
          id: crypto.randomUUID(),
          body: comment.trim(),
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setComment("");
  }

  function toggleApprove() {
    if (!pr) return;
    save.mutate({ ...pr, approved: !pr.approved });
  }

  function doMerge(strategy: MergeStrategy) {
    if (!pr) return;
    const message = pr.body.trim() ? `${pr.title}\n\n${pr.body}` : pr.title;
    merge.mutate(
      { base: pr.base, head: pr.head, message, strategy },
      {
        onSuccess: () => {
          save.mutate({
            ...pr,
            status: "merged",
            mergedAt: new Date().toISOString(),
          });
          const verb =
            strategy === "squash"
              ? "Squashed and merged"
              : strategy === "rebase"
                ? "Rebased and merged"
                : "Merged";
          toast.success(`${verb} ${pr.head} into ${pr.base}`);
        },
        onError: toastError,
      },
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="text-sm font-medium">{pr.title}</h2>
          <span className="flex-1" />
          <Badge
            variant={pr.status === "open" ? "default" : "secondary"}
            className="capitalize"
          >
            {pr.status}
          </Badge>
          {pr.approved && pr.status === "open" && (
            <Badge variant="secondary">approved</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{pr.head}</span>
          <span>→</span>
          <span className="font-mono">{pr.base}</span>
          <span>•</span>
          <span>local · {formatRelativeTime(pr.createdAt)}</span>
        </div>
        <div className="flex gap-1 pt-1">
          {(["conversation", "commits", "files"] as const).map((s) => (
            <Button
              key={s}
              variant={section === s ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setSection(s)}
            >
              {s === "conversation"
                ? "Conversation"
                : s === "commits"
                  ? `Commits (${ahead.length})`
                  : "Files"}
            </Button>
          ))}
        </div>
      </header>

      {section === "conversation" && (
        <>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-4">
              <div className="border-b pb-3">
                {pr.body.trim() ? (
                  <Markdown>{pr.body}</Markdown>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No description.
                  </p>
                )}
              </div>
              {pr.comments.map((c) => (
                <div key={c.id} className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(c.createdAt)}
                  </p>
                  <Markdown>{c.body}</Markdown>
                </div>
              ))}
              {pr.comments.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No comments yet.
                </p>
              )}
            </div>
          </ScrollArea>
          {pr.status === "open" && (
            <div className="space-y-2 border-t p-3">
              <Textarea
                placeholder="Leave a note…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className="max-h-32 min-h-12 resize-y"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!comment.trim()}
                  onClick={addComment}
                >
                  Comment
                </Button>
                <Button
                  variant={pr.approved ? "secondary" : "outline"}
                  size="sm"
                  onClick={toggleApprove}
                >
                  <CheckCircleIcon data-icon="inline-start" />
                  {pr.approved ? "Approved" : "Approve"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {section === "commits" && (
        <ScrollArea className="min-h-0 flex-1">
          {ahead.map((c) => (
            <div key={c.hash} className="border-b px-4 py-2">
              <p className="truncate text-xs font-medium">{c.subject}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{c.hash.slice(0, 7)}</span> ·{" "}
                {c.author} · {formatRelativeTime(c.date)}
              </p>
            </div>
          ))}
          {ahead.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No commits to merge.
            </p>
          )}
        </ScrollArea>
      )}

      {section === "files" && (
        <div className="min-h-0 flex-1">
          <BranchDiffView
            repoPath={repoPath}
            base={pr.base}
            compare={pr.head}
          />
        </div>
      )}

      <div className="flex items-center gap-2 border-t p-3">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={() => del.mutate(pr.id, { onSuccess: () => selectPr(null) })}
        >
          <TrashIcon data-icon="inline-start" />
          Delete
        </Button>
        <span className="flex-1" />
        {pr.status === "open" && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => save.mutate({ ...pr, status: "closed" })}
            >
              Close
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="sm"
                    disabled={!canMerge || merge.isPending}
                    title={
                      canMerge
                        ? `Merge ${pr.head} into ${pr.base}`
                        : "Approve the PR before merging"
                    }
                  >
                    <GitMergeIcon data-icon="inline-start" />
                    Merge
                    <CaretDownIcon data-icon="inline-end" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => doMerge("merge")}>
                  Create a merge commit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doMerge("squash")}>
                  Squash and merge
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doMerge("rebase")}>
                  Rebase and merge
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  );
}
