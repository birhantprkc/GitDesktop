import {
  ArrowDownIcon,
  ArrowUpIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { createAiClient } from "@/lib/ai/client";
import { buildCommitPrompt } from "@/lib/ai/prompt";
import { required, useAppForm } from "@/lib/form";
import {
  gitBranchDiff,
  gitRecentCommits,
  readRepoInstructions,
} from "@/lib/git/api";
import { useRewriteCommits } from "@/lib/git/queries";
import type { CommitSummary, RewriteStep } from "@/lib/git/types";
import { loadSettings } from "@/lib/settings/api";
import { toastError } from "@/lib/toast";

/**
 * Streams an AI commit message for the squashed run — the commit-box
 * generator pipeline, fed by the run's combined diff instead of the
 * staged diff.
 */
function useGenerateSquashMessage(
  repoPath: string,
  onText: (message: string) => void,
) {
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = () => abortRef.current?.abort();

  async function generate(base: string, head: string) {
    const abort = new AbortController();
    abortRef.current = abort;
    setGenerating(true);
    try {
      const settings = await loadSettings();
      const [diff, commits, repoInstructions] = await Promise.all([
        gitBranchDiff(repoPath, base, head, 200_000),
        gitRecentCommits(repoPath, 10),
        readRepoInstructions(repoPath),
      ]);
      if (!diff.text.trim()) {
        toast.error("These commits have no combined changes to describe.");
        return;
      }
      const { system, prompt } = buildCommitPrompt({
        diffText: diff.text,
        diffTruncated: diff.truncated,
        files: diff.files,
        excludedFiles: 0,
        recentSubjects: commits.map((c) => c.subject),
        repoInstructions,
        globalInstructions: settings.globalInstructions,
      });
      const client = await createAiClient(settings.ai);
      let buffer = "";
      for await (const chunk of client.stream({
        system,
        prompt,
        abortSignal: abort.signal,
      })) {
        buffer += chunk;
        onText(buffer);
      }
    } catch (e) {
      if (!abort.signal.aborted) toastError(e);
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  return { generate, cancel, generating };
}

/**
 * Confirms a squash of selected unpushed commits: edit the combined commit
 * message, then the rewrite engine replays `base..HEAD` with the run
 * collapsed into one commit. Conflicts roll back untouched.
 */
export function SquashDialog({
  repoPath,
  base,
  steps,
  count,
  defaultMessage,
  open,
  onOpenChange,
  onDone,
}: {
  repoPath: string;
  base: string;
  /** Oldest-first; exactly one multi-hash step takes the message. */
  steps: RewriteStep[];
  count: number;
  defaultMessage: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const rewrite = useRewriteCommits(repoPath);
  const ai = useGenerateSquashMessage(repoPath, (message) =>
    form.setFieldValue("message", message),
  );
  // The squash step is oldest-first, so its last hash is the run's tip;
  // diffing base..tip yields exactly the changes the new commit will hold.
  const runHead = steps.find((s) => s.hashes.length > 1)?.hashes.at(-1);

  const form = useAppForm({
    defaultValues: { message: defaultMessage },
    onSubmit: async ({ value }) => {
      try {
        await rewrite.mutateAsync({
          base,
          steps: steps.map((s) =>
            s.hashes.length > 1 ? { ...s, message: value.message.trim() } : s,
          ),
        });
        toast.success(`Squashed ${count} commits into one`);
        onOpenChange(false);
        onDone();
      } catch (e) {
        toastError(e);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Squash {count} commits?</DialogTitle>
            <DialogDescription>
              Combines the selected commits into one. This rewrites local
              history; if replaying hits a conflict, nothing is changed.
            </DialogDescription>
          </DialogHeader>
          <form.AppField
            name="message"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextareaField
                label="Commit message"
                rows={6}
                className="max-h-60 min-h-24 resize-y font-mono"
              />
            )}
          </form.AppField>
          <DialogFooter className="sm:items-center">
            {ai.generating ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mr-auto"
                onClick={ai.cancel}
              >
                <XIcon data-icon="inline-start" />
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mr-auto"
                disabled={!runHead}
                onClick={() => runHead && ai.generate(base, runHead)}
                title="Generate the commit message with AI"
              >
                <SparkleIcon data-icon="inline-start" />
                Generate
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton disabled={ai.generating}>
                Squash commits
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Reorders the unpushed commits with ↑/↓ per row, then replays them in the
 * new order. Apply stays disabled until the order actually changes.
 */
export function ReorderDialog({
  repoPath,
  base,
  commits,
  open,
  onOpenChange,
  onDone,
}: {
  repoPath: string;
  base: string;
  /** Newest-first, matching the history list. */
  commits: CommitSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const rewrite = useRewriteCommits(repoPath);
  const [order, setOrder] = useState<CommitSummary[]>(commits);
  // Reseed when a different set of commits comes in (render-time adjustment).
  const [lastKey, setLastKey] = useState("");
  const key = commits.map((c) => c.hash).join();
  if (key !== lastKey) {
    setLastKey(key);
    setOrder(commits);
  }

  const changed = order.some((c, i) => c.hash !== commits[i]?.hash);

  function move(index: number, delta: -1 | 1) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  }

  function apply() {
    // Steps are oldest-first; the dialog shows newest-first.
    const steps = [...order]
      .reverse()
      .map((c) => ({ hashes: [c.hash] }) as RewriteStep);
    rewrite.mutate(
      { base, steps },
      {
        onSuccess: () => {
          toast.success("Commits reordered");
          onOpenChange(false);
          onDone();
        },
        onError: (e) => toastError(e),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reorder commits</DialogTitle>
          <DialogDescription>
            Newest on top, like the history list. This rewrites local history;
            if replaying hits a conflict, nothing is changed.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-px overflow-y-auto border">
          {order.map((commit, index) => (
            <div
              key={commit.hash}
              className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0"
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {commit.hash.slice(0, 7)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">
                {commit.subject}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${commit.subject} up`}
                disabled={index === 0 || rewrite.isPending}
                onClick={() => move(index, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${commit.subject} down`}
                disabled={index === order.length - 1 || rewrite.isPending}
                onClick={() => move(index, 1)}
              >
                <ArrowDownIcon />
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!changed || rewrite.isPending} onClick={apply}>
            {rewrite.isPending && <Spinner data-icon="inline-start" />}
            Apply new order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
