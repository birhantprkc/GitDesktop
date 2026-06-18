import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createAiClient, MissingApiKeyError } from "@/lib/ai/client";
import {
  buildRepoDescriptionPrompt,
  extractRepoDetails,
} from "@/lib/ai/prompt";
import { readRepoInstructions, readTextFile } from "@/lib/git/api";
import { loadSettings } from "@/lib/settings/api";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

// READMEs the AI description is most usefully grounded in, in priority order.
const README_CANDIDATES = [
  "README.md",
  "Readme.md",
  "readme.md",
  "README",
  "README.rst",
  "README.txt",
  "docs/README.md",
];

async function readReadme(repoPath: string): Promise<string> {
  for (const name of README_CANDIDATES) {
    try {
      const text = await readTextFile(`${repoPath}/${name}`);
      if (text.trim()) return text;
    } catch {
      // missing/unreadable — try the next candidate
    }
  }
  return "";
}

/**
 * Suggests a GitHub "About" description + topics for the repo, grounded in its
 * README (falling back to the name alone). Mirrors useGenerateBranchName.
 */
export function useGenerateRepoDescription(repoPath: string) {
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const generate = useCallback(
    async (opts: {
      repoName: string;
      onResult: (result: { description: string; topics: string[] }) => void;
    }) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setGenerating(true);
      try {
        const settings = await loadSettings();
        const [readme, repoInstructions] = await Promise.all([
          readReadme(repoPath),
          readRepoInstructions(repoPath),
        ]);

        const { system, prompt } = buildRepoDescriptionPrompt({
          repoName: opts.repoName,
          readme,
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

        const details = extractRepoDetails(buffer);
        if (details.description || details.topics.length)
          opts.onResult(details);
        else toast.error("Couldn't generate a description — try again.");
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
