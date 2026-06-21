import { useCallback } from "react";
import { toast } from "sonner";
import { useAiStream } from "@/features/conversations/useAiStream";
import { buildPrPrompt, splitCommitMessage } from "@/lib/ai/prompt";
import { gitBranchDiff, readRepoInstructions } from "@/lib/git/api";

/** Raw diff bytes requested from the backend; prompt budgeting trims further. */
const RAW_DIFF_MAX_BYTES = 200_000;

/**
 * Streams an AI-written PR title + body from the branch diff and the commits
 * the PR would introduce. `onUpdate` fires with the parsed draft on each chunk.
 */
export function useGeneratePrDescription(repoPath: string) {
  const { generating, cancel, run } = useAiStream();

  const generate = useCallback(
    async (
      base: string,
      head: string,
      commitSubjects: string[],
      onUpdate: (draft: { title: string; body: string }) => void,
    ) => {
      await run(
        async (settings) => {
          const [diff, repoInstructions] = await Promise.all([
            gitBranchDiff(repoPath, base, head, RAW_DIFF_MAX_BYTES),
            readRepoInstructions(repoPath),
          ]);
          if (diff.files.length === 0) {
            toast.error("No changes between these branches to describe.");
            return null;
          }
          return buildPrPrompt({
            diffText: diff.text,
            diffTruncated: diff.truncated,
            files: diff.files,
            commitSubjects,
            baseBranch: base,
            headBranch: head,
            repoInstructions,
            globalInstructions: settings.globalInstructions,
          });
        },
        { onChunk: (buffer) => onUpdate(splitCommitMessage(buffer)) },
      );
    },
    [repoPath, run],
  );

  return { generate, cancel, generating };
}
