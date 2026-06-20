import { Popover } from "@base-ui/react/popover";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  DotsThreeIcon,
  GithubLogoIcon,
  PencilSimpleIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/components/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LocalComment } from "@/features/conversations/LocalComment";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { copyText } from "@/lib/clipboard";
import { required, useAppForm } from "@/lib/form";
import { useGhStatus } from "@/lib/git/queries";
import {
  useDeleteLocalIssue,
  useLocalIssues,
  useSaveLocalIssue,
} from "@/lib/issues/queries";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { PromoteLocalIssueDialog } from "./PromoteLocalIssueDialog";

export function LocalIssueView({
  repoPath,
  id,
}: {
  repoPath: string;
  id: string;
}) {
  const issues = useLocalIssues(repoPath);
  const issue = issues.data?.find((i) => i.id === id);
  const save = useSaveLocalIssue(repoPath);
  const del = useDeleteLocalIssue(repoPath);
  const selectIssue = useUiStore((s) => s.selectIssue);
  const ghStatus = useGhStatus(repoPath);
  const [comment, setComment] = useState("");
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const composerRef = useRef<MarkdownEditorHandle>(null);
  const editForm = useAppForm({
    defaultValues: { title: "", body: "" },
    onSubmit: async ({ value }) => {
      if (!issue) return;
      try {
        await save.mutateAsync({
          ...issue,
          title: value.title.trim(),
          body: value.body,
        });
        setEditOpen(false);
      } catch (e) {
        toastError(e);
      }
    },
  });

  if (!issue) {
    return <DiffPlaceholder message="This local issue no longer exists" />;
  }

  const isOpen = issue.status === "open";

  function addComment() {
    if (!issue || !comment.trim()) return;
    save.mutate({
      ...issue,
      comments: [
        ...issue.comments,
        {
          id: crypto.randomUUID(),
          body: comment.trim(),
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setComment("");
  }

  function editComment(commentId: string, body: string) {
    if (!issue) return;
    save.mutate({
      ...issue,
      comments: issue.comments.map((c) =>
        c.id === commentId ? { ...c, body } : c,
      ),
    });
  }

  function deleteComment(commentId: string) {
    if (!issue) return;
    save.mutate({
      ...issue,
      comments: issue.comments.filter((c) => c.id !== commentId),
    });
  }

  function setCommentHidden(commentId: string, hidden: boolean) {
    if (!issue) return;
    save.mutate({
      ...issue,
      comments: issue.comments.map((c) =>
        c.id === commentId ? { ...c, hidden } : c,
      ),
    });
  }

  function addLabel() {
    const name = labelInput.trim();
    if (!issue || !name) return;
    if (!issue.labels.includes(name)) {
      save.mutate({ ...issue, labels: [...issue.labels, name] });
    }
    setLabelInput("");
  }

  function removeLabel(label: string) {
    if (!issue) return;
    save.mutate({ ...issue, labels: issue.labels.filter((l) => l !== label) });
  }

  /** GitHub-style quote reply: prefixes each line with "> " in the composer. */
  function quoteReply(body: string) {
    const quoted = body
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setComment((prev) =>
      prev.trim() ? `${prev.trimEnd()}\n\n${quoted}\n\n` : `${quoted}\n\n`,
    );
    composerRef.current?.focus();
  }

  function openEdit() {
    if (!issue) return;
    editForm.reset(
      { title: issue.title, body: issue.body },
      { keepDefaultValues: true },
    );
    setEditOpen(true);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="text-sm font-medium">{issue.title}</h2>
          <span className="flex-1" />
          {isOpen && (
            <Button
              variant="outline"
              size="xs"
              onClick={openEdit}
              title="Edit the title and description"
            >
              <PencilSimpleIcon data-icon="inline-start" />
              Edit
            </Button>
          )}
          <Badge
            variant={isOpen ? "default" : "secondary"}
            className="capitalize"
          >
            {issue.status}
          </Badge>
          {issue.archived && <Badge variant="secondary">archived</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>local · opened {formatRelativeTime(issue.createdAt)}</span>
        </div>
        {(issue.labels.length > 0 || isOpen) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Trigger first, so it never shifts as chips come and go. */}
            {isOpen && (
              <Popover.Root>
                <Popover.Trigger
                  render={
                    <Button variant="ghost" size="xs" aria-label="Add label" />
                  }
                >
                  <TagIcon data-icon="inline-start" />
                  Labels
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner
                    align="start"
                    sideOffset={4}
                    className="isolate z-50"
                  >
                    <Popover.Popup className="w-60 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                      <p className="px-1 pb-1.5 text-xs font-medium">
                        Add label
                      </p>
                      <div className="flex gap-2 px-1">
                        <Input
                          value={labelInput}
                          onChange={(e) => setLabelInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addLabel();
                            }
                          }}
                          placeholder="e.g. bug, idea"
                          className="h-7 flex-1"
                          autoComplete="off"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!labelInput.trim()}
                          onClick={addLabel}
                        >
                          Add
                        </Button>
                      </div>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            )}
            {issue.labels.map((label) => (
              <span
                key={label}
                className="flex items-center gap-1 border px-1.5 py-0.5 text-[11px]"
              >
                {label}
                {isOpen && (
                  <button
                    type="button"
                    aria-label={`Remove label ${label}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removeLabel(label)}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <div className="group flex items-start justify-between gap-2 border-b pb-3">
            <div className="min-w-0 flex-1">
              {issue.body.trim() ? (
                <Markdown>{issue.body}</Markdown>
              ) : (
                <p className="text-xs text-muted-foreground">No description.</p>
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
                <DropdownMenuItem onClick={() => quoteReply(issue.body)}>
                  Quote reply
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => copyText(issue.body, "Markdown copied")}
                >
                  Copy markdown
                </DropdownMenuItem>
                {isOpen && (
                  <DropdownMenuItem onClick={openEdit}>Edit</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {issue.comments.map((c) => (
            <LocalComment
              key={c.id}
              comment={c}
              onQuote={() => quoteReply(c.body)}
              onSaveEdit={(body) => editComment(c.id, body)}
              onDelete={() => setDeletingCommentId(c.id)}
              onHide={() => setCommentHidden(c.id, true)}
              onUnhide={() => setCommentHidden(c.id, false)}
            />
          ))}
          {issue.comments.length === 0 && (
            <p className="text-xs text-muted-foreground">No comments yet.</p>
          )}
        </div>
      </ScrollArea>

      <div className="space-y-2 border-t p-3">
        <MarkdownEditor
          ref={composerRef}
          aria-label="Leave a note"
          placeholder="Leave a note…"
          value={comment}
          onChange={setComment}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              addComment();
            }
          }}
          rows={2}
          textareaClassName="max-h-32 min-h-12 resize-y"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!comment.trim()}
            onClick={addComment}
            title="Ctrl+Enter"
          >
            Comment
          </Button>
          {comment.trim() && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setComment("")}
              title="Discard this draft (e.g. a quote reply)"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t p-3">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <TrashIcon data-icon="inline-start" />
          Delete
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (issue.archived) {
              save.mutate({ ...issue, archived: false });
            } else {
              save.mutate({ ...issue, archived: true });
              selectIssue(null);
            }
          }}
        >
          <ArchiveIcon data-icon="inline-start" />
          {issue.archived ? "Unarchive" : "Archive"}
        </Button>
        <span className="flex-1" />
        {isOpen && (
          <>
            {Boolean(ghStatus.data?.repo) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPromoteOpen(true)}
                title="Open this issue on GitHub, carrying its comments"
              >
                <GithubLogoIcon data-icon="inline-start" />
                Publish to GitHub
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                save.mutate({
                  ...issue,
                  status: "closed",
                  closedAt: new Date().toISOString(),
                })
              }
            >
              Close
            </Button>
          </>
        )}
        {!isOpen && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => save.mutate({ ...issue, status: "open" })}
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            Reopen
          </Button>
        )}
      </div>

      <PromoteLocalIssueDialog
        repoPath={repoPath}
        issue={issue}
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this local issue?</DialogTitle>
            <DialogDescription>
              Permanently deletes "{issue.title}"
              {issue.comments.length > 0
                ? ` and its ${issue.comments.length} comment${
                    issue.comments.length === 1 ? "" : "s"
                  }`
                : ""}
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(issue.id, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    selectIssue(null);
                  },
                  onError: toastError,
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
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
                Updates the title and description of this local issue.
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
                  textareaClassName="max-h-72"
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
              Removes this comment from the local issue. This cannot be undone.
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
              onClick={() => {
                if (deletingCommentId) deleteComment(deletingCommentId);
                setDeletingCommentId(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
