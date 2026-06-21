import {
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleIcon,
  DotsThreeIcon,
  GitBranchIcon,
  GitMergeIcon,
  PencilSimpleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/components/markdown-editor";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { CommitsList } from "@/features/conversations/CommitsList";
import { DeleteCommentDialog } from "@/features/conversations/DeleteCommentDialog";
import {
  EditTitleBodyDialog,
  useEditTitleBody,
} from "@/features/conversations/EditTitleBodyDialog";
import { LabelsPopover } from "@/features/conversations/LabelsPopover";
import { makeQuoteReply } from "@/features/conversations/quoteReply";
import { ReactionBar } from "@/features/conversations/ReactionBar";
import {
  AuthorAvatar,
  hasVisibleBody,
  LabelChip,
  Thread,
} from "@/features/conversations/Thread";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { isMergeMethodAllowed } from "@/lib/branch-rules/match";
import { useEffectiveBranchRules } from "@/lib/branch-rules/queries";
import { copyText } from "@/lib/clipboard";
import {
  ghPrDiff,
  type MergeStrategy,
  type MinimizeReason,
  type ReviewAction,
} from "@/lib/git/api";
import { splitUnifiedDiff } from "@/lib/git/diff-split";
import {
  useCheckoutPr,
  useClosePr,
  useCommentPr,
  useDeletePrComment,
  useEditPr,
  useEditPrComment,
  useMergePr,
  useMinimizeComment,
  usePrDetails,
  usePrDiff,
  usePrReactions,
  useReadyPr,
  useReopenPr,
  useRepoStatus,
  useReviewPr,
  useToggleReaction,
  useUnminimizeComment,
} from "@/lib/git/queries";
import { useAiEnabled } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PrReviewPanel } from "./PrReviewPanel";
import { MergePrDialog, PrFilesPane } from "./RemotePrViewParts";

type Section = "conversation" | "commits" | "files" | "review";

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
  const checkout = useCheckoutPr(repoPath);
  const repoStatus = useRepoStatus(repoPath);
  const mergePr = useMergePr(repoPath);
  const closePr = useClosePr(repoPath);
  const reopenPr = useReopenPr(repoPath);
  const editComment = useEditPrComment(repoPath);
  const deleteComment = useDeletePrComment(repoPath);
  const minimizeComment = useMinimizeComment(repoPath);
  const unminimizeComment = useUnminimizeComment(repoPath);
  const readyPr = useReadyPr(repoPath);
  const editPr = useEditPr(repoPath);
  const reactions = usePrReactions(repoPath, number);
  const toggleReactionMutation = useToggleReaction(
    repoPath,
    ["repo", repoPath, "pr", number, "reactions"] as const,
    details.data?.id ?? "",
  );
  const [section, setSection] = useState<Section>("conversation");
  const pendingPrSection = useUiStore((s) => s.pendingPrSection);
  const setPendingPrSection = useUiStore((s) => s.setPendingPrSection);
  const selectedPr = useUiStore((s) => s.selectedPr);
  // The activity dock's "View" lands here via a pending hint; switch to the
  // review sub-tab once, then clear it. Guarded on this being the *selected* PR
  // so a still-mounted lagging view (deferredPr) can't swallow the hint first.
  useEffect(() => {
    const isSelected =
      selectedPr?.kind === "remote" && selectedPr.id === String(number);
    if (pendingPrSection === "review" && isSelected) {
      setSection("review");
      setPendingPrSection(null);
    }
  }, [pendingPrSection, setPendingPrSection, selectedPr, number]);
  const aiEnabled = useAiEnabled();
  const rulesConfig = useEffectiveBranchRules(repoPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [composeBody, setComposeBody] = useState("");
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>("merge");
  const [deleteBranch, setDeleteBranch] = useState(false);
  const edit = useEditTitleBody({
    onSave: async ({ title, body }) => {
      await editPr.mutateAsync({ number, title, body });
    },
    successToast: "Pull request updated",
  });
  const composerRef = useRef<MarkdownEditorHandle>(null);

  const onError = (e: unknown) => toastError(e);

  const quoteReply = makeQuoteReply({ composerRef, setBody: setComposeBody });

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

  // Reset the manual file selection when a different PR is shown — a
  // render-time state adjustment, not an effect.
  const [lastNumber, setLastNumber] = useState(number);
  if (number !== lastNumber) {
    setLastNumber(number);
    setSelectedPath(null);
  }
  // Default to the first changed file until the user picks one.
  const effectivePath =
    selectedPath && pr?.files.some((f) => f.path === selectedPath)
      ? selectedPath
      : (pr?.files[0]?.path ?? null);

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

  const fileDiff = effectivePath
    ? {
        filePath: effectivePath,
        text: fileSections.get(effectivePath) ?? "",
        isBinary: (fileSections.get(effectivePath) ?? "").includes(
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
    reopenPr.isPending ||
    readyPr.isPending;

  function saveCommentEdit(commentId: string, body: string) {
    editComment.mutate(
      { commentId, body },
      {
        onSuccess: () => toast.success("Comment updated"),
        onError,
      },
    );
  }

  function toggleReaction(subjectId: string, content: string, active: boolean) {
    toggleReactionMutation.mutate({ subjectId, content, active }, { onError });
  }

  function hideComment(commentId: string, classifier: MinimizeReason) {
    minimizeComment.mutate(
      { commentId, classifier },
      { onSuccess: () => toast.success("Comment hidden"), onError },
    );
  }

  function unhideComment(commentId: string) {
    unminimizeComment.mutate(commentId, {
      onSuccess: () => toast.success("Comment shown"),
      onError,
    });
  }

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
          {isOpen &&
            (repoStatus.data?.branch?.name === pr.headRefName ? (
              <Button
                variant="outline"
                size="xs"
                disabled
                title={`${pr.headRefName} is the current branch`}
              >
                <CheckCircleIcon data-icon="inline-start" />
                Checked out
              </Button>
            ) : (
              <Button
                variant="outline"
                size="xs"
                disabled={checkout.isPending}
                onClick={() =>
                  checkout.mutate(number, {
                    onSuccess: () =>
                      toast.success(`Checked out ${pr.headRefName}`),
                    onError,
                  })
                }
                title={`Check out ${pr.headRefName} locally`}
              >
                {checkout.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <GitBranchIcon data-icon="inline-start" />
                )}
                Checkout
              </Button>
            ))}
          {isOpen && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => edit.openEdit({ title: pr.title, body: pr.body })}
              title="Edit the title and description"
            >
              <PencilSimpleIcon data-icon="inline-start" />
              Edit
            </Button>
          )}
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
          <AuthorAvatar login={pr.author} />
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
        {isOpen ? (
          <LabelsPopover
            repoPath={repoPath}
            enabled
            labelableId={pr.id}
            labels={pr.labels}
          />
        ) : (
          pr.labels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {pr.labels.map((label) => (
                <LabelChip key={label.name} label={label} />
              ))}
            </div>
          )
        )}
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
          {(
            (aiEnabled
              ? ["conversation", "commits", "files", "review"]
              : ["conversation", "commits", "files"]) as Section[]
          ).map((s) => (
            <Button
              key={s}
              variant={section === s ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={section === s}
              onClick={() => setSection(s)}
            >
              {s === "conversation"
                ? `Conversation (${pr.comments.length})`
                : s === "commits"
                  ? `Commits (${pr.commits.length})`
                  : s === "files"
                    ? `Files (${pr.files.length})`
                    : "Review"}
            </Button>
          ))}
        </div>
      </header>

      {aiEnabled && section === "review" && (
        <PrReviewPanel
          prKind="remote"
          prRef={String(number)}
          context={{
            title: pr.title,
            body: pr.body,
            commitSubjects: pr.commits.map((c) => c.headline),
            repoPath,
            // gh GraphQL returns commits oldest-first, so the head is the last.
            headSha: pr.commits.at(-1)?.oid,
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
            comment.mutateAsync({ number, body }).catch((e) => {
              onError(e);
              throw e; // let the panel skip its success toast / text clear
            })
          }
        />
      )}

      {section === "conversation" && (
        <>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-4">
              <div className="group space-y-1 border-b pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {pr.body.trim() ? (
                      <Markdown>{pr.body}</Markdown>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No description provided.
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Description actions"
                          className="shrink-0 text-muted-foreground hover:text-foreground data-popup-open:text-foreground"
                        />
                      }
                    >
                      <DotsThreeIcon className="size-4" weight="bold" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      <DropdownMenuItem
                        onClick={() => copyText(pr.url, "Link copied")}
                      >
                        Copy link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => quoteReply(pr.body)}>
                        Quote reply
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => copyText(pr.body, "Markdown copied")}
                      >
                        Copy markdown
                      </DropdownMenuItem>
                      {isOpen && (
                        <DropdownMenuItem
                          onClick={() =>
                            edit.openEdit({ title: pr.title, body: pr.body })
                          }
                        >
                          Edit
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <ReactionBar
                  reactions={reactions.data?.body ?? []}
                  onToggle={(content, active) =>
                    toggleReaction(pr.id, content, active)
                  }
                />
              </div>
              {/* Events with nothing visible to say (empty body, or only an
                  unfilled-template HTML comment) render as a bare author
                  line — drop them. */}
              {pr.reviews
                .filter((r) => hasVisibleBody(r.body) || r.state)
                .map((r) => (
                  <Thread
                    // Reviews carry no node id (id is "" for reviews), but each
                    // review submission has a unique author+timestamp.
                    key={`${r.author}-${r.date}`}
                    thread={r}
                    onQuote={
                      hasVisibleBody(r.body)
                        ? () => quoteReply(r.body)
                        : undefined
                    }
                  />
                ))}
              {pr.comments
                .filter((c) => hasVisibleBody(c.body))
                .map((c) => (
                  <Thread
                    key={c.id}
                    thread={c}
                    onQuote={() => quoteReply(c.body)}
                    onSaveEdit={
                      c.viewerDidAuthor
                        ? (body) => saveCommentEdit(c.id, body)
                        : undefined
                    }
                    onDelete={
                      c.viewerDidAuthor
                        ? () => setDeletingCommentId(c.id)
                        : undefined
                    }
                    onHide={
                      c.isMinimized
                        ? undefined
                        : (classifier) => hideComment(c.id, classifier)
                    }
                    onUnhide={
                      c.isMinimized ? () => unhideComment(c.id) : undefined
                    }
                    reactions={reactions.data?.comments[c.id]}
                    onToggleReaction={(content, active) =>
                      toggleReaction(c.id, content, active)
                    }
                  />
                ))}
              {pr.reviews.length === 0 && pr.comments.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No activity yet.
                </p>
              )}
            </div>
          </ScrollArea>
          {/* Shown for closed/merged PRs too — GitHub lets you comment (and
              quote-reply) after a PR closes; only reviews are open-only. */}
          <div className="space-y-2 border-t p-3">
            <MarkdownEditor
              ref={composerRef}
              aria-label="Leave a comment"
              placeholder="Leave a comment…"
              value={composeBody}
              onChange={setComposeBody}
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
              textareaClassName="max-h-32 min-h-12 resize-y"
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
              {isOpen && (
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
              )}
              {composeBody.trim() && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => setComposeBody("")}
                  title="Discard this draft (e.g. a quote reply)"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {section === "commits" && (
        <CommitsList
          commits={pr.commits.map((c) => ({
            id: c.oid,
            subject: c.headline,
            shortSha: c.oid.slice(0, 7),
            author: c.author,
            date: c.date,
          }))}
        />
      )}

      {section === "files" && (
        <PrFilesPane
          files={pr.files}
          effectivePath={effectivePath}
          onSelectPath={setSelectedPath}
          fileDiff={fileDiff}
          isPending={prDiff.isPending}
          isError={prDiff.isError}
        />
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
              {(["merge", "squash", "rebase"] as const).map((s) => {
                const blocked = !isMergeMethodAllowed(
                  rulesConfig,
                  pr.baseRefName,
                  s,
                );
                return (
                  <DropdownMenuItem
                    key={s}
                    disabled={blocked}
                    onClick={() => {
                      setMergeStrategy(s);
                      setDeleteBranch(false);
                      setMergeOpen(true);
                    }}
                  >
                    {MERGE_LABEL[s]}
                    {blocked && " — blocked by branch rule"}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {pr.state === "CLOSED" && (
        <div className="flex items-center gap-2 border-t p-3">
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              reopenPr.mutate(number, {
                onSuccess: () => toast.success(`Reopened #${number}`),
                onError,
              })
            }
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            Reopen
          </Button>
        </div>
      )}

      <MergePrDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        number={number}
        headRefName={pr.headRefName}
        baseRefName={pr.baseRefName}
        strategyLabel={MERGE_LABEL[mergeStrategy]}
        deleteBranch={deleteBranch}
        onDeleteBranchChange={setDeleteBranch}
        pending={mergePr.isPending}
        onConfirm={confirmMerge}
      />

      <EditTitleBodyDialog
        form={edit.form}
        open={edit.open}
        onOpenChange={edit.setOpen}
        title="Edit pull request"
        description={`Updates the title and description of #${number} on GitHub.`}
        contentClassName="sm:max-w-lg"
        bodyTextareaClassName="max-h-72 min-h-24 resize-y font-mono"
      />

      <DeleteCommentDialog
        commentId={deletingCommentId}
        onClose={() => setDeletingCommentId(null)}
        pending={deleteComment.isPending}
        onConfirm={(commentId) =>
          deleteComment.mutate(commentId, {
            onSuccess: () => {
              toast.success("Comment deleted");
              setDeletingCommentId(null);
            },
            onError: (e) => {
              onError(e);
              setDeletingCommentId(null);
            },
          })
        }
      />
    </div>
  );
}
