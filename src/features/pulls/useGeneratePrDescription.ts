import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createAiClient } from "@/lib/ai/client";
import { buildPrPrompt, splitCommitMessage } from "@/lib/ai/prompt";
import { gitBranchDiff, readRepoInstructions } from "@/lib/git/api";
import { loadSettings } from "@/lib/settings/api";
import { toastError } from "@/lib/toast";

/** Raw diff bytes requested from the backend; prompt budgeting trims further. */
const RAW_DIFF_MAX_BYTES = 200_000;

/**
 * Streams an AI-written PR title + body from the branch diff and the commits
 * the PR would introduce. `onUpdate` fires with the parsed draft on each chunk.
 */
export function useGeneratePrDescription(repoPath: string) {
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const generate = useCallback(
    async (
      base: string,
      head: string,
      commitSubjects: string[],
      onUpdate: (draft: { title: string; body: string }) => void,
    ) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setGenerating(true);
      try {
        const settings = await loadSettings();
        const [diff, repoInstructions] = await Promise.all([
          gitBranchDiff(repoPath, base, head, RAW_DIFF_MAX_BYTES),
          readRepoInstructions(repoPath),
        ]);
        if (diff.files.length === 0) {
          toast.error("No changes between these branches to describe.");
          return;
        }

        const { system, prompt } = buildPrPrompt({
          diffText: diff.text,
          diffTruncated: diff.truncated,
          files: diff.files,
          commitSubjects,
          baseBranch: base,
          headBranch: head,
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
          onUpdate(splitCommitMessage(buffer));
        }
      } catch (e) {
        if (!abort.signal.aborted) toastError(e);
      } finally {
        setGenerating(false);
        abortRef.current = null;
      }
    },
    [repoPath],
  );

  return { generate, cancel, generating };
}
