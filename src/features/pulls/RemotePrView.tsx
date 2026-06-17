import { Popover } from "@base-ui/react/popover";
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
  TagIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffContent } from "@/features/diff/DiffSurface";
import { isMergeMethodAllowed } from "@/lib/branch-rules/match";
import { useEffectiveBranchRules } from "@/lib/branch-rules/queries";
import { copyText } from "@/lib/clipboard";
import { required, useAppForm } from "@/lib/form";
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
  useEditPrLabels,
  useMergePr,
  useMinimizeComment,
  usePrDetails,
  usePrDiff,
  useReadyPr,
  useReopenPr,
  useRepoLabels,
  useRepoStatus,
  useReviewPr,
  useUnminimizeComment,
} from "@/lib/git/queries";
import type { PrThreadOut, RepoLabel } from "@/lib/git/types";
import { useAiEnabled } from "@/lib/settings/queries";
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
  const editLabels = useEditPrLabels(repoPath);
  const repoLabels = useRepoLabels(repoPath, true);
  const [section, setSection] = useState<Section>("conversation");
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
  const [editOpen, setEditOpen] = useState(false);
  const editForm = useAppForm({
    defaultValues: { title: "", body: "" },
    onSubmit: async ({ value }) => {
      try {
        await editPr.mutateAsync({
          number,
          title: value.title.trim(),
          body: value.body,
        });
        setEditOpen(false);
        toast.success("Pull request updated");
      } catch (e) {
        toastError(e);
      }
    },
  });
  // Label edits are drafted locally while the picker is open and committed
  // as one batched mutation when it closes — instant checkboxes, no popover
  // re-anchoring as chips change, one network call.
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [draftLabels, setDraftLabels] = useState<Set<string>>(new Set());
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const onError = (e: unknown) => toastError(e);

  function toggleDraftLabel(name: string, on: boolean) {
    setDraftLabels((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function handleLabelsOpenChange(open: boolean) {
    const current = details.data;
    if (!current) return;
    if (open) {
      setDraftLabels(new Set(current.labels.map((l) => l.name)));
      setLabelsOpen(true);
      return;
    }
    setLabelsOpen(false);
    const applied = new Set(current.labels.map((l) => l.name));
    const idByName = new Map(
      (repoLabels.data ?? []).map((l) => [l.name, l.id]),
    );
    const ids = (names: string[]) =>
      names.map((n) => idByName.get(n)).filter((id): id is string => !!id);
    const addIds = ids([...draftLabels].filter((n) => !applied.has(n)));
    const removeIds = ids([...applied].filter((n) => !draftLabels.has(n)));
    if (addIds.length > 0 || removeIds.length > 0) {
      editLabels.mutate(
        { labelableId: current.id, addIds, removeIds },
        { onError },
      );
    }
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
              onClick={() => {
                // keepDefaultValues: otherwise the per-render options sync
                // clobbers the seeded values back to empty (untouched form).
                editForm.reset(
                  { title: pr.title, body: pr.body },
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
        {(pr.labels.length > 0 || isOpen) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Trigger first, so it never shifts as chips come and go. */}
            {isOpen && (
              <Popover.Root
                open={labelsOpen}
                onOpenChange={handleLabelsOpenChange}
              >
                <Popover.Trigger
                  render={
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label="Edit labels"
                    />
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
            )}
            {pr.labels.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </div>
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
          context={{
            title: pr.title,
            body: pr.body,
            commitSubjects: pr.commits.map((c) => c.headline),
            repoPath,
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
              <div className="group flex items-start justify-between gap-2 border-b pb-3">
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
                        onClick={() => {
                          editForm.reset(
                            { title: pr.title, body: pr.body },
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
                    effectivePath === file.path
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
            {effectivePath ? (
              <DiffContent
                filePath={effectivePath}
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
              <DialogTitle>Edit pull request</DialogTitle>
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
    </div>
  );
}

/** Hide reasons GitHub accepts: menu label → ReportedContentClassifiers value. */
const HIDE_REASONS: [string, MinimizeReason][] = [
  ["Off-topic", "OFF_TOPIC"],
  ["Outdated", "OUTDATED"],
  ["Resolved", "RESOLVED"],
  ["Duplicate", "DUPLICATE"],
  ["Spam", "SPAM"],
  ["Abuse", "ABUSE"],
];

/** "OFF_TOPIC" -> "off-topic" for the "hidden · <reason>" label. */
function formatReason(reason: string): string {
  return reason.toLowerCase().replace(/_/g, "-");
}

/** GitHub avatar that links to the author's profile. Avatars are served from
 *  github.com/<login>.png; CSP is unrestricted so they load directly, and the
 *  Avatar primitive falls back to the initial if the image can't load. */
function AuthorAvatar({ login }: { login: string }) {
  if (!login) return null;
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => openUrl(`https://github.com/${login}`)}
      title={`@${login} on GitHub`}
      className="shrink-0 rounded-full hover:opacity-80 cursor-pointer"
    >
      <Avatar size="sm">
        <AvatarImage
          src={`https://github.com/${login}.png?size=48`}
          alt={login}
        />
        <AvatarFallback>{login.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
    </Button>
  );
}

function Thread({
  thread,
  onQuote,
  onSaveEdit,
  onDelete,
  onHide,
  onUnhide,
}: {
  thread: PrThreadOut;
  onQuote?: () => void;
  /** Present when the viewer may edit this comment; saves the new body. */
  onSaveEdit?: (body: string) => void;
  /** Present when the viewer may delete this comment. */
  onDelete?: () => void;
  /** Hide (minimize) the comment with a reason. */
  onHide?: (classifier: MinimizeReason) => void;
  /** Unhide a previously hidden comment. */
  onUnhide?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const minimized = thread.isMinimized;
  return (
    <div className="group space-y-1">
      <p className="flex items-center gap-2 text-xs">
        <AuthorAvatar login={thread.author} />
        <span className="font-medium">{thread.author || "unknown"}</span>
        {thread.state && (
          <Badge variant="secondary">{thread.state.toLowerCase()}</Badge>
        )}
        <span className="text-muted-foreground">
          {thread.date && formatRelativeTime(thread.date)}
        </span>
        {minimized && (
          <span className="text-[11px] text-muted-foreground italic">
            hidden
            {thread.minimizedReason
              ? ` · ${formatReason(thread.minimizedReason)}`
              : ""}
          </span>
        )}
        {!editing && (
          <>
            <span className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Comment actions"
                    className="text-muted-foreground hover:text-foreground data-popup-open:text-foreground"
                  />
                }
              >
                <DotsThreeIcon className="size-4" weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                {thread.url && (
                  <DropdownMenuItem
                    onClick={() => copyText(thread.url, "Link copied")}
                  >
                    Copy link
                  </DropdownMenuItem>
                )}
                {onQuote && (
                  <DropdownMenuItem onClick={onQuote}>
                    Quote reply
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => copyText(thread.body, "Markdown copied")}
                >
                  Copy markdown
                </DropdownMenuItem>
                {onSaveEdit && (
                  <DropdownMenuItem
                    onClick={() => {
                      setDraft(thread.body);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                )}
                {onUnhide && minimized && (
                  <DropdownMenuItem onClick={onUnhide}>Unhide</DropdownMenuItem>
                )}
                {onHide && !minimized && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Hide…</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {HIDE_REASONS.map(([label, classifier]) => (
                        <DropdownMenuItem
                          key={classifier}
                          onClick={() => onHide(classifier)}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {onDelete && (
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </p>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="max-h-48 min-h-16 resize-y font-mono"
          />
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={!draft.trim() || draft.trim() === thread.body.trim()}
              onClick={() => {
                onSaveEdit?.(draft.trim());
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : minimized && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Show hidden comment
        </button>
      ) : (
        <>
          {minimized && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Hide comment
            </button>
          )}
          {thread.body.trim() && <Markdown>{thread.body}</Markdown>}
        </>
      )}
    </div>
  );
}

function LabelChip({ label }: { label: RepoLabel }) {
  return (
    <span className="flex items-center gap-1 border px-1.5 py-0.5 text-[11px]">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: `#${label.color}` }}
      />
      {label.name}
    </span>
  );
}
