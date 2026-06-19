import { Popover } from "@base-ui/react/popover";
import {
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRef, useState } from "react";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ReactionBar } from "@/features/conversations/ReactionBar";
import {
  AuthorAvatar,
  hasVisibleBody,
  LabelChip,
  Thread,
} from "@/features/conversations/Thread";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { copyText } from "@/lib/clipboard";
import { required, useAppForm } from "@/lib/form";
import type { LockReason, MinimizeReason } from "@/lib/git/api";
import {
  useCloseIssue,
  useCommentIssue,
  useDeleteIssue,
  useDeletePrComment,
  useEditIssue,
  useEditPrComment,
  useEditPrLabels,
  useGhRepos,
  useIssueDetails,
  useIssueReactions,
  useLockIssue,
  useMinimizeComment,
  usePinIssue,
  useReopenIssue,
  useRepoLabels,
  useSetIssueAssignees,
  useSetIssueMilestone,
  useSetIssueType,
  useToggleReaction,
  useTransferIssue,
  useUnlockIssue,
  useUnminimizeComment,
} from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { IssueDevelopment } from "./IssueDevelopment";
import {
  AssigneesPopover,
  IssueTypeMenu,
  MilestoneMenu,
} from "./IssueMetaPickers";
import { IssueRelations } from "./IssueRelations";

/** GitHub's lock reasons (menu label → API value); null locks with no reason. */
const LOCK_REASONS: [string, LockReason | null][] = [
  ["No reason", null],
  ["Off-topic", "off_topic"],
  ["Resolved", "resolved"],
  ["Spam", "spam"],
  ["Too heated", "too_heated"],
];

/**
 * Full read+write view for a GitHub issue: header, description, threaded
 * conversation, comment composer, label editor, close-with-reason / reopen, and
 * edit. Labels and comment edit/delete/hide reuse the PR GraphQL mutations,
 * which key off node ids and so work unchanged for issues.
 */
export function RemoteIssueView({
  repoPath,
  number,
}: {
  repoPath: string;
  number: number;
}) {
  const details = useIssueDetails(repoPath, number);
  const comment = useCommentIssue(repoPath);
  const closeIssue = useCloseIssue(repoPath);
  const reopenIssue = useReopenIssue(repoPath);
  const editIssue = useEditIssue(repoPath);
  const editComment = useEditPrComment(repoPath);
  const deleteComment = useDeletePrComment(repoPath);
  const minimizeComment = useMinimizeComment(repoPath);
  const unminimizeComment = useUnminimizeComment(repoPath);
  const editLabels = useEditPrLabels(repoPath);
  const repoLabels = useRepoLabels(repoPath, true);
  const setAssignees = useSetIssueAssignees(repoPath);
  const setMilestone = useSetIssueMilestone(repoPath);
  const setType = useSetIssueType(repoPath);
  const pinIssue = usePinIssue(repoPath);
  const lockIssue = useLockIssue(repoPath);
  const unlockIssue = useUnlockIssue(repoPath);
  const transferIssue = useTransferIssue(repoPath);
  const deleteIssue = useDeleteIssue(repoPath);
  const selectIssue = useUiStore((s) => s.selectIssue);
  const setPendingIssueDraft = useUiStore((s) => s.setPendingIssueDraft);
  const reactions = useIssueReactions(repoPath, number);
  const toggleReactionMutation = useToggleReaction(
    repoPath,
    ["repo", repoPath, "issue", number, "reactions"] as const,
    details.data?.id ?? "",
  );

  const [composeBody, setComposeBody] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [draftLabels, setDraftLabels] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDest, setTransferDest] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const transferRepos = useGhRepos(transferOpen);

  const onError = (e: unknown) => toastError(e);

  const issue = details.data;
  const editForm = useAppForm({
    defaultValues: { title: "", body: "" },
    onSubmit: async ({ value }) => {
      try {
        await editIssue.mutateAsync({
          number,
          title: value.title.trim(),
          body: value.body,
        });
        setEditOpen(false);
        toast.success("Issue updated");
      } catch (e) {
        toastError(e);
      }
    },
  });

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
  const busy =
    comment.isPending || closeIssue.isPending || reopenIssue.isPending;
  const comments = issue.comments.filter((c) => hasVisibleBody(c.body));

  function submitComment() {
    if (!composeBody.trim()) return;
    comment.mutate(
      { number, body: composeBody.trim() },
      {
        onSuccess: () => setComposeBody(""),
        onError,
      },
    );
  }

  /** GitHub-style quote reply: prefixes each line with "> " in the composer. */
  function quoteReply(body: string) {
    const quoted = body
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setComposeBody((prev) =>
      prev.trim() ? `${prev.trimEnd()}\n\n${quoted}\n\n` : `${quoted}\n\n`,
    );
    composerRef.current?.focus();
  }

  function doClose(reason: "completed" | "not_planned") {
    closeIssue.mutate(
      { number, reason },
      { onSuccess: () => toast.success(`Closed #${number}`), onError },
    );
  }

  function saveCommentEdit(commentId: string, body: string) {
    editComment.mutate(
      { commentId, body },
      { onSuccess: () => toast.success("Comment updated"), onError },
    );
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

  function toggleReaction(subjectId: string, content: string, active: boolean) {
    toggleReactionMutation.mutate({ subjectId, content, active }, { onError });
  }

  // Seeds + opens the GitHub create dialog (IssuesPanel consumes the draft).
  // Labels carry over since they're from this same repo.
  function duplicateIssue() {
    if (!issue) return;
    setPendingIssueDraft({
      title: issue.title,
      body: issue.body,
      labels: issue.labels.map((l) => l.name),
    });
  }

  function submitTransfer() {
    const destination = transferDest.trim();
    if (!destination) return;
    transferIssue.mutate(
      { number, destination },
      {
        onSuccess: (url) => {
          toast.success(
            `Transferred #${number}`,
            url
              ? {
                  description: url,
                  action: { label: "View", onClick: () => openUrl(url) },
                }
              : undefined,
          );
          setTransferOpen(false);
          // The issue no longer lives in this repo; clear the now-stale view.
          selectIssue(null);
        },
        onError,
      },
    );
  }

  function confirmDelete() {
    deleteIssue.mutate(number, {
      onSuccess: () => {
        toast.success(`Deleted #${number}`);
        setDeleteOpen(false);
        selectIssue(null);
      },
      onError: (e) => {
        onError(e);
        setDeleteOpen(false);
      },
    });
  }

  // Repo suggestions for the transfer destination (excludes archived repos,
  // which can't receive transfers); only loaded while the dialog is open.
  const repoQuery = transferDest.trim().toLowerCase();
  const repoSuggestions = (transferRepos.data?.repos ?? [])
    .filter((r) => !r.archived)
    .map((r) => r.nameWithOwner)
    .filter((n) => !repoQuery || n.toLowerCase().includes(repoQuery))
    .slice(0, 6);

  function toggleDraftLabel(name: string, on: boolean) {
    setDraftLabels((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  // Label edits are drafted while the picker is open and committed as one
  // batched mutation when it closes — instant checkboxes, one network call.
  function handleLabelsOpenChange(open: boolean) {
    if (!issue) return;
    if (open) {
      setDraftLabels(new Set(issue.labels.map((l) => l.name)));
      setLabelsOpen(true);
      return;
    }
    setLabelsOpen(false);
    const applied = new Set(issue.labels.map((l) => l.name));
    const idByName = new Map(
      (repoLabels.data ?? []).map((l) => [l.name, l.id]),
    );
    const ids = (names: string[]) =>
      names.map((n) => idByName.get(n)).filter((id): id is string => !!id);
    const addIds = ids([...draftLabels].filter((n) => !applied.has(n)));
    const removeIds = ids([...applied].filter((n) => !draftLabels.has(n)));
    if (addIds.length > 0 || removeIds.length > 0) {
      editLabels.mutate(
        { labelableId: issue.id, addIds, removeIds },
        { onError },
      );
    }
  }

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
          {isOpen && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                // keepDefaultValues: otherwise the per-render options sync
                // clobbers the seeded values back to empty (untouched form).
                editForm.reset(
                  { title: issue.title, body: issue.body },
                  { keepDefaultValues: true },
                );
                setEditOpen(true);
              }}
              title="Edit the title and description"
            >
              <PencilSimpleIcon data-icon="inline-start" />
              Edit
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            onClick={() => openUrl(issue.url)}
            title="Open this issue on GitHub"
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            GitHub
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="xs" aria-label="More actions" />
              }
            >
              <DotsThreeIcon className="size-4" weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem
                onClick={() =>
                  pinIssue.mutate(
                    { number, pinned: !issue.isPinned },
                    {
                      onSuccess: () =>
                        toast.success(issue.isPinned ? "Unpinned" : "Pinned"),
                      onError,
                    },
                  )
                }
              >
                {issue.isPinned ? "Unpin issue" : "Pin issue"}
              </DropdownMenuItem>
              {issue.locked ? (
                <DropdownMenuItem
                  onClick={() =>
                    unlockIssue.mutate(number, {
                      onSuccess: () => toast.success("Conversation unlocked"),
                      onError,
                    })
                  }
                >
                  Unlock conversation
                </DropdownMenuItem>
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    Lock conversation…
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {LOCK_REASONS.map(([label, reason]) => (
                      <DropdownMenuItem
                        key={reason ?? "none"}
                        onClick={() =>
                          lockIssue.mutate(
                            { number, reason },
                            {
                              onSuccess: () =>
                                toast.success("Conversation locked"),
                              onError,
                            },
                          )
                        }
                      >
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={duplicateIssue}>
                Duplicate issue
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setTransferDest("");
                  setTransferOpen(true);
                }}
              >
                Transfer issue…
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                Delete issue…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={isOpen ? "default" : "secondary"}>
            {issue.state.toLowerCase()}
          </Badge>
          {issue.isPinned && <Badge variant="secondary">pinned</Badge>}
          {issue.locked && (
            <Badge variant="secondary">
              locked
              {issue.activeLockReason
                ? ` · ${issue.activeLockReason.replace(/_/g, "-")}`
                : ""}
            </Badge>
          )}
          <AuthorAvatar login={issue.author} />
          <span>{issue.author || "unknown"}</span>
          <span>•</span>
          <span>opened {formatRelativeTime(issue.createdAt)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Trigger first, so it never shifts as chips come and go. */}
          <Popover.Root open={labelsOpen} onOpenChange={handleLabelsOpenChange}>
            <Popover.Trigger
              render={
                <Button variant="ghost" size="xs" aria-label="Edit labels" />
              }
            >
              {editLabels.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <TagIcon data-icon="inline-start" />
              )}
              Labels
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                align="start"
                sideOffset={4}
                className="isolate z-50"
              >
                <Popover.Popup className="w-60 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                  <p className="px-1 pb-1.5 text-xs font-medium">Labels</p>
                  {(repoLabels.data ?? []).length === 0 && (
                    <p className="px-1 py-1 text-xs text-muted-foreground">
                      {repoLabels.isPending
                        ? "Loading labels…"
                        : "This repository has no labels."}
                    </p>
                  )}
                  {(repoLabels.data ?? []).map((label) => (
                    <label
                      key={label.name}
                      className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-xs hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={draftLabels.has(label.name)}
                        onCheckedChange={(v) =>
                          toggleDraftLabel(label.name, v === true)
                        }
                      />
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: `#${label.color}` }}
                      />
                      <span className="flex-1 truncate">{label.name}</span>
                    </label>
                  ))}
                  {(repoLabels.data ?? []).length > 0 && (
                    <p className="mt-1 border-t px-1 pt-1.5 text-[11px] text-muted-foreground">
                      Changes apply when this closes.
                    </p>
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          {issue.labels.map((label) => (
            <LabelChip key={label.name} label={label} />
          ))}
        </div>
        <AssigneesPopover
          repoPath={repoPath}
          enabled
          value={issue.assignees}
          commitOnClose
          onChange={(next) =>
            setAssignees.mutate({ number, assignees: next }, { onError })
          }
        />
        <MilestoneMenu
          repoPath={repoPath}
          enabled
          value={issue.milestone?.number ?? null}
          valueLabel={issue.milestone?.title}
          onChange={(m) =>
            setMilestone.mutate({ number, milestone: m }, { onError })
          }
        />
        <IssueTypeMenu
          repoPath={repoPath}
          enabled
          value={issue.issueType}
          onChange={(typeName) =>
            setType.mutate({ number, typeName }, { onError })
          }
        />
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
              <span className="flex-1" />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Description actions"
                      className="text-muted-foreground hover:text-foreground data-popup-open:text-foreground"
                    />
                  }
                >
                  <DotsThreeIcon className="size-4" weight="bold" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem
                    onClick={() => copyText(issue.url, "Link copied")}
                  >
                    Copy link
                  </DropdownMenuItem>
                  {hasVisibleBody(issue.body) && (
                    <DropdownMenuItem onClick={() => quoteReply(issue.body)}>
                      Quote reply
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => copyText(issue.body, "Markdown copied")}
                  >
                    Copy markdown
                  </DropdownMenuItem>
                  {isOpen && (
                    <DropdownMenuItem
                      onClick={() => {
                        editForm.reset(
                          { title: issue.title, body: issue.body },
                          { keepDefaultValues: true },
                        );
                        setEditOpen(true);
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </p>
            {hasVisibleBody(issue.body) ? (
              <Markdown>{issue.body}</Markdown>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No description provided.
              </p>
            )}
            <ReactionBar
              reactions={reactions.data?.body ?? []}
              onToggle={(content, active) =>
                toggleReaction(issue.id, content, active)
              }
            />
          </div>
          <IssueRelations
            repoPath={repoPath}
            issueId={issue.id}
            number={number}
          />
          <IssueDevelopment repoPath={repoPath} number={number} />
          {comments.map((c) => (
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
                c.viewerDidAuthor ? () => setDeletingCommentId(c.id) : undefined
              }
              onHide={
                c.isMinimized
                  ? undefined
                  : (classifier) => hideComment(c.id, classifier)
              }
              onUnhide={c.isMinimized ? () => unhideComment(c.id) : undefined}
              reactions={reactions.data?.comments[c.id]}
              onToggleReaction={(content, active) =>
                toggleReaction(c.id, content, active)
              }
            />
          ))}
          {comments.length === 0 && (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          )}
        </div>
      </ScrollArea>
      {/* Comment is allowed after the issue closes too, matching GitHub. */}
      <div className="space-y-2 border-t p-3">
        <Textarea
          ref={composerRef}
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
          {composeBody.trim() && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setComposeBody("")}
              title="Discard this draft (e.g. a quote reply)"
            >
              Clear
            </Button>
          )}
          <span className="flex-1" />
          {isOpen ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => doClose("completed")}
              >
                Close issue
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="Other close options"
                      disabled={busy}
                    />
                  }
                >
                  <CaretDownIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem onClick={() => doClose("completed")}>
                    Close as completed
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => doClose("not_planned")}>
                    Close as not planned
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                reopenIssue.mutate(number, {
                  onSuccess: () => toast.success(`Reopened #${number}`),
                  onError,
                })
              }
            >
              <ArrowCounterClockwiseIcon data-icon="inline-start" />
              Reopen
            </Button>
          )}
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              editForm.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit issue</DialogTitle>
              <DialogDescription>
                Updates the title and description of #{number} on GitHub.
              </DialogDescription>
            </DialogHeader>
            <editForm.AppField
              name="title"
              validators={{ onChange: ({ value }) => required(value) }}
            >
              {(field) => <field.TextField label="Title" />}
            </editForm.AppField>
            <editForm.AppField name="body">
              {(field) => (
                <field.MarkdownField
                  label="Description"
                  rows={8}
                  textareaClassName="max-h-72 min-h-24 resize-y font-mono"
                />
              )}
            </editForm.AppField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <editForm.AppForm>
                <editForm.SubmitButton>Save</editForm.SubmitButton>
              </editForm.AppForm>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletingCommentId !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingCommentId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete comment?</DialogTitle>
            <DialogDescription>
              This permanently deletes the comment on GitHub. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingCommentId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteComment.isPending}
              onClick={() => {
                const commentId = deletingCommentId;
                if (!commentId) return;
                deleteComment.mutate(commentId, {
                  onSuccess: () => {
                    toast.success("Comment deleted");
                    setDeletingCommentId(null);
                  },
                  onError: (e) => {
                    onError(e);
                    setDeletingCommentId(null);
                  },
                });
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitTransfer();
            }}
          >
            <DialogHeader>
              <DialogTitle>Transfer issue #{number}</DialogTitle>
              <DialogDescription>
                Moves this issue to another repository you can push to. Its
                comments, labels, and assignees move with it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Input
                autoFocus
                value={transferDest}
                onChange={(e) => setTransferDest(e.target.value)}
                placeholder="owner/repo"
                autoComplete="off"
              />
              {repoSuggestions.length > 0 && (
                <div className="max-h-40 overflow-auto border">
                  {repoSuggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-muted/60"
                      onClick={() => setTransferDest(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTransferOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!transferDest.trim() || transferIssue.isPending}
              >
                {transferIssue.isPending && (
                  <Spinner data-icon="inline-start" />
                )}
                Transfer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete issue #{number}?</DialogTitle>
            <DialogDescription>
              This permanently deletes “{issue.title}” on GitHub. This cannot be
              undone, and requires admin or triage access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteIssue.isPending}
              onClick={confirmDelete}
            >
              {deleteIssue.isPending && <Spinner data-icon="inline-start" />}
              Delete issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
