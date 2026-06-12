import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { triggerAutomations } from "@/lib/automations/runner";
import { coAuthorTrailers } from "@/lib/git/co-authors";
import { useCommit, useRepoStatus } from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { CoAuthorPicker } from "./CoAuthorPicker";
import { useGenerateCommitMessage } from "./useGenerateCommitMessage";

export function CommitBox({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const commit = useCommit(repoPath);
  const title = useUiStore((s) => s.commitTitle);
  const body = useUiStore((s) => s.commitBody);
  const amendingHash = useUiStore((s) => s.amendingHash);
  const coAuthors = useUiStore((s) => s.commitCoAuthors);
  const setCommitTitle = useUiStore((s) => s.setCommitTitle);
  const setCommitBody = useUiStore((s) => s.setCommitBody);
  const setCoAuthors = useUiStore((s) => s.setCommitCoAuthors);
  const clearCommitDraft = useUiStore((s) => s.clearCommitDraft);
  const { generate, cancel, generating } = useGenerateCommitMessage(repoPath);

  const amending = amendingHash !== null;
  const branchName = status.data?.branch?.name ?? null;
  const stagedCount =
    status.data?.entries.filter((e) => e.staged !== null).length ?? 0;
  // amending without staged changes is valid (message-only edit)
  const canCommit =
    title.trim().length > 0 &&
    (stagedCount > 0 || amending) &&
    !commit.isPending;

  // Ctrl/Cmd+Enter from either field commits — the category-standard
  // accelerator for the highest-frequency action in the app.
  function onCommitKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canCommit) {
      e.preventDefault();
      doCommit();
    }
  }

  function doCommit() {
    const commitTitle = title.trim();
    // Trailers must be the final paragraph of the message.
    const fullBody = [body.trim(), coAuthorTrailers(coAuthors)]
      .filter(Boolean)
      .join("\n\n");
    commit.mutate(
      { title: commitTitle, body: fullBody || undefined, amend: amending },
      {
        onSuccess: (result) => {
          clearCommitDraft();
          toast.success(
            `${amending ? "Amended" : "Committed"} ${result.hash.slice(0, 7)}`,
          );
          // Amending rewrites an existing commit; only new commits fire
          // on-commit automations.
          if (!amending) {
            triggerAutomations({
              kind: "commit",
              repoPath,
              hash: result.hash,
              title: commitTitle,
            });
          }
        },
        onError: (e) => toastError(e),
      },
    );
  }

  return (
    <div className="space-y-2 border-t p-3">
      {amending && (
        <div className="flex items-center justify-between bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
          <span>Amending {amendingHash?.slice(0, 7)}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Cancel amend"
            onClick={clearCommitDraft}
          >
            <XIcon />
          </Button>
        </div>
      )}
      <div className="relative">
        <Input
          placeholder="Commit title"
          value={title}
          onChange={(e) => setCommitTitle(e.target.value)}
          onKeyDown={onCommitKeyDown}
          disabled={generating}
          className="pr-12"
          autoComplete="off"
        />
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] tabular-nums",
            title.length > 72 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {title.length > 0 && `${title.length}/72`}
        </span>
      </div>
      <Textarea
        placeholder="Description (optional)"
        value={body}
        onChange={(e) => setCommitBody(e.target.value)}
        onKeyDown={onCommitKeyDown}
        disabled={generating}
        rows={4}
        // cap the content-based auto-grow so a long generated body can't
        // swallow the changes list; resize-y lets the user drag it back down
        className="max-h-48 min-h-16 resize-y"
      />
      <CoAuthorPicker
        repoPath={repoPath}
        value={coAuthors}
        onChange={setCoAuthors}
        disabled={generating}
      />
      <div className="flex gap-2">
        {generating ? (
          <Button variant="outline" size="sm" onClick={cancel}>
            <XIcon data-icon="inline-start" />
            Cancel
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={stagedCount === 0}
            onClick={generate}
            title={
              stagedCount === 0
                ? "Stage changes to generate a commit message"
                : "Generate commit message with AI"
            }
          >
            <SparkleIcon data-icon="inline-start" />
            Generate
          </Button>
        )}
        <Button
          size="sm"
          className="min-w-0 flex-1"
          disabled={!canCommit || generating}
          onClick={doCommit}
          title="Ctrl+Enter"
        >
          {commit.isPending && <Spinner data-icon="inline-start" />}
          <span className="truncate">
            {amending
              ? "Amend"
              : `Commit${stagedCount > 0 ? ` (${stagedCount})` : ""}${
                  branchName ? ` to ${branchName}` : ""
                }`}
          </span>
        </Button>
      </div>
    </div>
  );
}
