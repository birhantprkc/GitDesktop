import { Popover } from "@base-ui/react/popover";
import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  GitMergeIcon,
  PencilSimpleIcon,
  QuotesIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { BranchDiffView } from "@/features/compare/BranchDiffView";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { required, useAppForm } from "@/lib/form";
import { gitBranchDiff, type MergeStrategy } from "@/lib/git/api";
import {
  useBranchDiffFiles,
  useCompareBranches,
  useMergeLocalPr,
} from "@/lib/git/queries";
import {
  useDeleteLocalPr,
  useLocalPrs,
  useSaveLocalPr,
} from "@/lib/pulls/queries";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { PrReviewPanel } from "./PrReviewPanel";

type Section = "conversation" | "commits" | "files" | "review";

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const editForm = useAppForm({
    defaultValues: { title: "", body: "" },
    onSubmit: async ({ value }) => {
      if (!pr) return;
      try {
        await save.mutateAsync({
          ...pr,
          title: value.title.trim(),
          body: value.body,
        });
        setEditOpen(false);
      } catch (e) {
        toastError(e);
      }
    },
  });
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const comparison = useCompareBranches(
    repoPath,
    pr?.base ?? null,
    pr?.head ?? null,
  );
  const diffFiles = useBranchDiffFiles(
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
  const fileCount = diffFiles.data?.length;
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

  function addLabel() {
    const name = labelInput.trim();
    if (!pr || !name) return;
    if (!pr.labels.includes(name)) {
      save.mutate({ ...pr, labels: [...pr.labels, name] });
    }
    setLabelInput("");
  }

  function removeLabel(label: string) {
    if (!pr) return;
    save.mutate({ ...pr, labels: pr.labels.filter((l) => l !== label) });
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
    if (!pr) return;
    // keepDefaultValues: otherwise the per-render options sync clobbers the
    // seeded values back to empty (untouched form).
    editForm.reset(
      { title: pr.title, body: pr.body },
      { keepDefaultValues: true },
    );
    setEditOpen(true);
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
          {pr.status === "open" && (
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
        {(pr.labels.length > 0 || pr.status === "open") && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Trigger first, so it never shifts as chips come and go. */}
            {pr.status === "open" && (
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
                          placeholder="e.g. bug, refactor"
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
            {pr.labels.map((label) => (
              <span
                key={label}
                className="flex items-center gap-1 border px-1.5 py-0.5 text-[11px]"
              >
                {label}
                {pr.status === "open" && (
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
                    ? `Commits (${ahead.length})`
                    : s === "files"
                      ? `Files${fileCount === undefined ? "" : ` (${fileCount})`}`
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
            commitSubjects: ahead.map((c) => c.subject),
            loadDiff: () =>
              gitBranchDiff(repoPath, pr.base, pr.head, 200000).then((d) => ({
                text: d.text,
                truncated: d.truncated,
                files: d.files,
              })),
          }}
          onPost={(body) =>
            save.mutate({
              ...pr,
              comments: [
                ...pr.comments,
                {
                  id: crypto.randomUUID(),
                  body,
                  createdAt: new Date().toISOString(),
                },
              ],
            })
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
                    No description.
                  </p>
                )}
              </div>
              {pr.comments.map((c) => (
                <div key={c.id} className="group space-y-1">
                  <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {formatRelativeTime(c.createdAt)}
                    {pr.status === "open" && (
                      <>
                        <span className="flex-1" />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Quote reply"
                          title="Quote reply"
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => quoteReply(c.body)}
                        >
                          <QuotesIcon />
                        </Button>
                      </>
                    )}
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
                ref={composerRef}
                placeholder="Leave a note…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    addComment();
                  }
                }}
                rows={2}
                className="max-h-32 min-h-12 resize-y"
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
          onClick={() => setConfirmDelete(true)}
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
        {pr.status === "closed" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => save.mutate({ ...pr, status: "open" })}
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            Reopen
          </Button>
        )}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this local pull request?</DialogTitle>
            <DialogDescription>
              Permanently deletes "{pr.title}"
              {pr.comments.length > 0
                ? ` and its ${pr.comments.length} comment${
                    pr.comments.length === 1 ? "" : "s"
                  }`
                : ""}
              . The branches are not affected. This cannot be undone.
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
                del.mutate(pr.id, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    selectPr(null);
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
              <DialogTitle>Edit pull request</DialogTitle>
              <DialogDescription>
                Updates the title and description of this local pull request.
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
    </div>
  );
}
