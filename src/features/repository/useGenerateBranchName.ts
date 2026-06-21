import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createAiClient, MissingApiKeyError } from "@/lib/ai/client";
import { buildBranchNamePrompt, extractBranchName } from "@/lib/ai/prompt";
import {
  gitStagedDiff,
  readRepoAiIgnore,
  readRepoInstructions,
} from "@/lib/git/api";
import { sanitizeRefName } from "@/lib/git/ref-name";
import type { FileEntry } from "@/lib/git/types";
import { loadSettings } from "@/lib/settings/api";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

/** Raw diff bytes requested from the backend; prompt budgeting trims further. */
const RAW_DIFF_MAX_BYTES = 200_000;

/**
 * Suggests a branch name from the repo's in-progress changes (the whole working
 * tree vs HEAD, plus untracked file names), using the existing branches as a
 * convention reference. The caller gates this on having changes — there's
 * nothing to name a branch after when the tree is clean.
 */
export function useGenerateBranchName(repoPath: string) {
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const generate = useCallback(
    async (opts: {
      entries: FileEntry[];
      recentBranches: string[];
      onName: (name: string) => void;
    }) => {
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

        const [diff, repoInstructions] = await Promise.all([
          gitStagedDiff(repoPath, {
            maxBytes: RAW_DIFF_MAX_BYTES,
            exclude,
            worktree: true,
          }),
          readRepoInstructions(repoPath),
        ]);

        // `git diff HEAD` omits untracked files; bring their names in so a
        // branch made of all-new files can still be named.
        const untrackedPaths = opts.entries
          .filter((e) => e.unstaged === "untracked")
          .map((e) => e.path);

        if (diff.files.length === 0 && untrackedPaths.length === 0) {
          toast.error(
            diff.excludedFiles > 0
              ? "All changes match your AI ignore patterns — nothing to name a branch after."
              : "No in-progress changes to name a branch after.",
          );
          return;
        }

        const { system, prompt } = buildBranchNamePrompt({
          diffText: diff.text,
          diffTruncated: diff.truncated,
          files: diff.files,
          untrackedPaths,
          excludedFiles: diff.excludedFiles,
          recentBranches: opts.recentBranches,
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
        }

        const name = sanitizeRefName(extractBranchName(buffer));
        if (name) opts.onName(name);
        else toast.error("Couldn't generate a branch name — try again.");
      } catch (e) {
        if (!abort.signal.aborted) {
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
    },
    [repoPath],
  );

  return { generate, cancel, generating };
}
