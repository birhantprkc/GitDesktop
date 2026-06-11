import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleIcon,
  GitMergeIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffContent } from "@/features/diff/DiffSurface";
import { ghPrDiff, type MergeStrategy, type ReviewAction } from "@/lib/git/api";
import { splitUnifiedDiff } from "@/lib/git/diff-split";
import {
  useClosePr,
  useCommentPr,
  useMergePr,
  usePrDetails,
  usePrDiff,
  useReadyPr,
  useReviewPr,
} from "@/lib/git/queries";
import type { PrThreadOut } from "@/lib/git/types";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PrReviewPanel } from "./PrReviewPanel";

type Section = "conversation" | "commits" | "files" | "review";

/**
 * Whether a thread body renders any visible content. Raw HTML is disabled in
 * our Markdown component, so a body that is only HTML comments (e.g. an
 * unfilled PR template) displays as nothing.
 */
function hasVisibleBody(body: string): boolean {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
}

const MERGE_LABEL: Record<MergeStrategy, string> = {
  merge: "Create a merge commit",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

/**
 * Tone + glyph for a CI check, so pass/fail isn't conveyed by color alone.
 */
function checkPresentation(status: string): {
  tone: string;
  Icon: typeof CheckCircleIcon;
  label: string;
} {
  const s = status.toUpperCase();
  if (s === "SUCCESS") {
    return {
      tone: "text-green-600 dark:text-green-400",
      Icon: CheckCircleIcon,
      label: "passed",
    };
  }
  if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(s)) {
    return {
      tone: "text-red-600 dark:text-red-400",
      Icon: XCircleIcon,
      label: "failed",
    };
  }
  return {
    tone: "text-amber-600 dark:text-amber-400",
    Icon: CircleIcon,
    label: "pending",
  };
}

export function RemotePrView({
  repoPath,
  number,
}: {
  repoPath: string;
  number: number;
}) {
  const details = usePrDetails(repoPath, number);
  const prDiff = usePrDiff(repoPath, number);
  const review = useReviewPr(repoPath);
  const comment = useCommentPr(repoPath);
  const mergePr = useMergePr(repoPath);
  const closePr = useClosePr(repoPath);
  const readyPr = useReadyPr(repoPath);
  const [section, setSection] = useState<Section>("conversation");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [composeBody, setComposeBody] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>("merge");
  const [deleteBranch, setDeleteBranch] = useState(false);

  const onError = (e: unknown) => toastError(e);

  function submitReview(action: ReviewAction) {
    review.mutate(
      { number, action, body: composeBody.trim() },
      {
        onSuccess: () => {
          toast.success(
            action === "approve"
              ? "Approved"
              : action === "request_changes"
                ? "Requested changes"
                : "Review submitted",
          );
          setComposeBody("");
        },
        onError,
      },
    );
  }

  function submitComment() {
    if (!composeBody.trim()) return;
    comment.mutate(
      { number, body: composeBody.trim() },
      {
        onSuccess: () => {
          toast.success("Comment added");
          setComposeBody("");
        },
        onError,
      },
    );
  }

  function confirmMerge() {
    mergePr.mutate(
      { number, strategy: mergeStrategy, deleteBranch },
      {
        onSuccess: () => {
          toast.success(`Merged #${number}`);
          setMergeOpen(false);
        },
        onError: (e) => {
          onError(e);
          setMergeOpen(false);
        },
      },
    );
  }

  const pr = details.data;
  const fileSections = useMemo(
    () => splitUnifiedDiff(prDiff.data ?? ""),
    [prDiff.data],
  );

  useEffect(() => {
    setSelectedPath(pr?.files[0]?.path ?? null);
  }, [pr?.files]);

  if (details.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (details.isError || !pr) {
    return <DiffPlaceholder message="Could not load this pull request" />;
  }

  const fileDiff = selectedPath
    ? {
        filePath: selectedPath,
        text: fileSections.get(selectedPath) ?? "",
        isBinary: (fileSections.get(selectedPath) ?? "").includes(
          "Binary files ",
        ),
        isTruncated: false,
      }
    : undefined;

  const isOpen = pr.state === "OPEN";
  const busy =
    review.isPending ||
    comment.isPending ||
    mergePr.isPending ||
    closePr.isPending ||
    readyPr.isPending;

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="text-sm font-medium">
            {pr.title}{" "}
            <span className="font-normal text-muted-foreground">
              #{pr.number}
            </span>
          </h2>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="xs"
            onClick={() => openUrl(pr.url)}
            title="Open this pull request on GitHub"
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            GitHub
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={pr.state === "OPEN" ? "default" : "secondary"}>
            {pr.isDraft ? "Draft" : pr.state.toLowerCase()}
          </Badge>
          <span>{pr.author}</span>
          <span>•</span>
          <span className="font-mono">{pr.headRefName}</span>
          <span>→</span>
          <span className="font-mono">{pr.baseRefName}</span>
          <span className="text-green-600 dark:text-green-400">
            +{pr.additions}
          </span>
          <span className="text-red-600 dark:text-red-400">
            -{pr.deletions}
          </span>
        </div>
        {pr.checks.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {pr.checks.map((c) => {
              const { tone, Icon, label } = checkPresentation(c.status);
              return (
                <span
                  key={c.name}
                  className={cn("flex items-center gap-1 truncate", tone)}
                  title={`${c.name}: ${label}`}
                >
                  <Icon className="size-3 shrink-0" aria-label={label} />
                  {c.name}
                </span>
              );
            })}
          </div>
        )}
        <div className="flex gap-1 pt-1">
          {(["conversation", "commits", "files", "review"] as const).map(
            (s) => (
              <Button
                key={s}
                variant={section === s ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={section === s}
                onClick={() => setSection(s)}
              >
                {s === "conversation"
                  ? "Conversation"
                  : s === "commits"
                    ? `Commits (${pr.commits.length})`
                    : s === "files"
                      ? `Files (${pr.files.length})`
                      : "Review"}
              </Button>
            ),
          )}
        </div>
      </header>

      {section === "review" && (
        <PrReviewPanel
          context={{
            title: pr.title,
            body: pr.body,
            commitSubjects: pr.commits.map((c) => c.headline),
            loadDiff: () =>
              ghPrDiff(repoPath, number).then((text) => ({
                text,
                truncated: false,
                files: pr.files.map((f) => ({
                  path: f.path,
                  added: f.additions,
                  deleted: f.deletions,
                  isBinary: false,
                })),
              })),
          }}
          posting={comment.isPending}
          onPost={(body) =>
            comment.mutate(
              { number, body },
              {
                onSuccess: () => toast.success("Review posted as a comment"),
                onError,
              },
            )
          }
        />
      )}

      {section === "conversation" && (
        <>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-4">
              <div className="border-b pb-3">
                {pr.body.trim() ? (
                  <Markdown>{pr.body}</Markdown>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No description provided.
                  </p>
                )}
              </div>
              {/* Events with nothing visible to say (empty body, or only an
                  unfilled-template HTML comment) render as a bare author
                  line — drop them. */}
              {pr.reviews
                .filter((r) => hasVisibleBody(r.body) || r.state)
                .map((r, i) => (
                  <Thread key={`r${i}-${r.author}`} thread={r} />
                ))}
              {pr.comments
                .filter((c) => hasVisibleBody(c.body))
                .map((c, i) => (
                  <Thread key={`c${i}-${c.author}`} thread={c} />
                ))}
              {pr.reviews.length === 0 && pr.comments.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No activity yet.
                </p>
              )}
            </div>
          </ScrollArea>
          {isOpen && (
            <div className="space-y-2 border-t p-3">
              <Textarea
                placeholder="Leave a comment…"
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    (e.ctrlKey || e.metaKey) &&
                    e.key === "Enter" &&
                    composeBody.trim() &&
                    !busy
                  ) {
                    e.preventDefault();
                    submitComment();
                  }
                }}
                rows={2}
                className="max-h-32 min-h-12 resize-y"
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!composeBody.trim() || busy}
                  onClick={submitComment}
                  title="Ctrl+Enter"
                >
                  Comment
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="sm" disabled={busy}>
                        Review
                        <CaretDownIcon data-icon="inline-end" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent className="w-52">
                    <DropdownMenuItem onClick={() => submitReview("approve")}>
                      Approve
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => submitReview("comment")}>
                      Comment
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => submitReview("request_changes")}
                    >
                      Request changes
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
        </>
      )}

      {section === "commits" && (
        <ScrollArea className="min-h-0 flex-1">
          {pr.commits.map((c) => (
            <div key={c.oid} className="border-b px-4 py-2">
              <p className="truncate text-xs font-medium">{c.headline}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{c.oid.slice(0, 7)}</span> •{" "}
                {c.author} • {c.date && formatRelativeTime(c.date)}
              </p>
            </div>
          ))}
        </ScrollArea>
      )}

      {section === "files" && (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r">
            <ScrollArea className="min-h-0 flex-1">
              {pr.files.map((file) => (
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
                  <span className="shrink-0 tabular-nums">
                    <span className="text-green-600 dark:text-green-400">
                      +{file.additions}
                    </span>{" "}
                    <span className="text-red-600 dark:text-red-400">
                      -{file.deletions}
                    </span>
                  </span>
                </button>
              ))}
            </ScrollArea>
          </aside>
          <main className="min-w-0 flex-1">
            {selectedPath ? (
              <DiffContent
                filePath={selectedPath}
                data={fileDiff}
                isPending={prDiff.isPending}
                isError={prDiff.isError}
              />
            ) : (
              <DiffPlaceholder message="Select a file to see its changes" />
            )}
          </main>
        </div>
      )}

      {isOpen && (
        <div className="flex items-center gap-2 border-t p-3">
          {pr.isDraft && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                readyPr.mutate(number, {
                  onSuccess: () => toast.success("Marked ready for review"),
                  onError,
                })
              }
            >
              Ready for review
            </Button>
          )}
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              closePr.mutate(number, {
                onSuccess: () => toast.success(`Closed #${number}`),
                onError,
              })
            }
          >
            Close
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  disabled={busy || pr.isDraft}
                  title={
                    pr.isDraft
                      ? "Mark the PR ready before merging"
                      : "Merge this pull request"
                  }
                >
                  <GitMergeIcon data-icon="inline-start" />
                  Merge
                  <CaretDownIcon data-icon="inline-end" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-56">
              {(["merge", "squash", "rebase"] as const).map((s) => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => {
                    setMergeStrategy(s);
                    setDeleteBranch(false);
                    setMergeOpen(true);
                  }}
                >
                  {MERGE_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge pull request #{number}?</DialogTitle>
            <DialogDescription>
              {MERGE_LABEL[mergeStrategy]} — merges{" "}
              <span className="font-mono">{pr.headRefName}</span> into{" "}
              <span className="font-mono">{pr.baseRefName}</span> on GitHub.
              This cannot be easily undone.
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={deleteBranch}
              onCheckedChange={(checked) => setDeleteBranch(checked === true)}
            />
            Delete <span className="font-mono">{pr.headRefName}</span> after
            merging
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button disabled={mergePr.isPending} onClick={confirmMerge}>
              {mergePr.isPending && <Spinner data-icon="inline-start" />}
              {MERGE_LABEL[mergeStrategy]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Thread({ thread }: { thread: PrThreadOut }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 text-xs">
        <span className="font-medium">{thread.author || "unknown"}</span>
        {thread.state && (
          <Badge variant="secondary">{thread.state.toLowerCase()}</Badge>
        )}
        <span className="text-muted-foreground">
          {thread.date && formatRelativeTime(thread.date)}
        </span>
      </p>
      {thread.body.trim() && <Markdown>{thread.body}</Markdown>}
    </div>
  );
}
