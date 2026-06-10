import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useCommit, useRepoStatus } from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { errorMessage } from "@/lib/tauri/invoke";
import { cn } from "@/lib/utils";
import { useGenerateCommitMessage } from "./useGenerateCommitMessage";

export function CommitBox({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const commit = useCommit(repoPath);
  const title = useUiStore((s) => s.commitTitle);
  const body = useUiStore((s) => s.commitBody);
  const setCommitTitle = useUiStore((s) => s.setCommitTitle);
  const setCommitBody = useUiStore((s) => s.setCommitBody);
  const clearCommitDraft = useUiStore((s) => s.clearCommitDraft);
  const { generate, cancel, generating } = useGenerateCommitMessage(repoPath);

  const stagedCount =
    status.data?.entries.filter((e) => e.staged !== null).length ?? 0;
  const canCommit =
    title.trim().length > 0 && stagedCount > 0 && !commit.isPending;

  function doCommit() {
    commit.mutate(
      { title: title.trim(), body: body.trim() || undefined },
      {
        onSuccess: (result) => {
          clearCommitDraft();
          toast.success(`Committed ${result.hash.slice(0, 7)}`);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <div className="space-y-2 border-t p-3">
      <div className="relative">
        <Input
          placeholder="Commit title"
          value={title}
          onChange={(e) => setCommitTitle(e.target.value)}
          disabled={generating}
          className="pr-12"
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
        disabled={generating}
        rows={4}
        // cap the content-based auto-grow so a long generated body can't
        // swallow the changes list; resize-y lets the user drag it back down
        className="max-h-48 min-h-16 resize-y"
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
          className="flex-1"
          disabled={!canCommit || generating}
          onClick={doCommit}
        >
          {commit.isPending && <Spinner data-icon="inline-start" />}
          Commit{stagedCount > 0 && ` (${stagedCount})`}
        </Button>
      </div>
    </div>
  );
}
