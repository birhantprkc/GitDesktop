import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { createAiClient, MissingApiKeyError } from "@/lib/ai/client";
import { buildCommitPrompt, splitCommitMessage } from "@/lib/ai/prompt";
import {
  gitRecentCommits,
  gitStagedDiff,
  readRepoAiIgnore,
  readRepoInstructions,
} from "@/lib/git/api";
import { loadSettings } from "@/lib/settings/api";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

/** Raw diff bytes requested from the backend; prompt budgeting trims further. */
const RAW_DIFF_MAX_BYTES = 200_000;

export function useGenerateCommitMessage(repoPath: string) {
  const setCommitDraft = useUiStore((s) => s.setCommitDraft);
  const setGenerating = useUiStore((s) => s.setGenerating);
  const generating = useUiStore((s) => s.generating);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const generate = useCallback(async () => {
    const abort = new AbortController();
    abortRef.current = abort;
    setGenerating(true);
    try {
      const settings = await loadSettings();
      const repoIgnore = await readRepoAiIgnore(repoPath);
      const globalIgnore = settings.aiIgnorePatterns
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      const exclude = [...repoIgnore, ...globalIgnore];

      const [staged, commits, repoInstructions] = await Promise.all([
        gitStagedDiff(repoPath, RAW_DIFF_MAX_BYTES, exclude),
        gitRecentCommits(repoPath, 10),
        readRepoInstructions(repoPath),
      ]);
      if (staged.files.length === 0) {
        toast.error(
          staged.excludedFiles > 0
            ? "All staged changes match your AI ignore patterns — nothing to describe."
            : "Nothing is staged — stage some changes first.",
        );
        return;
      }

      const { system, prompt } = buildCommitPrompt({
        diffText: staged.text,
        diffTruncated: staged.truncated,
        files: staged.files,
        excludedFiles: staged.excludedFiles,
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
        const { title, body } = splitCommitMessage(buffer);
        setCommitDraft(title, body);
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        // A missing key is a setup gap, not an error to copy — point straight
        // at the place that fixes it.
        if (e instanceof MissingApiKeyError) {
          toast.error(e.message, {
            duration: 8000,
            action: {
              label: "Open settings",
              onClick: () => useUiStore.getState().openSettings("ai"),
            },
          });
        } else {
          toastError(e);
        }
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [repoPath, setCommitDraft, setGenerating]);

  return { generate, cancel, generating };
}
