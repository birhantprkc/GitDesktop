import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createAiClient, MissingApiKeyError } from "@/lib/ai/client";
import { buildIssueDraftPrompt, extractIssueDraft } from "@/lib/ai/prompt";
import { readIssueTemplates, readRepoInstructions } from "@/lib/git/api";
import { loadSettings } from "@/lib/settings/api";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

/**
 * Expands a user's rough notes into a structured GitHub issue (title + body),
 * following the repo's issue template(s) when present. Mirrors
 * useGenerateRepoDescription.
 */
export function useGenerateIssueDraft(repoPath: string) {
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const generate = useCallback(
    async (opts: {
      notes: string;
      repoName: string;
      onResult: (result: { title: string; body: string }) => void;
    }) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setGenerating(true);
      try {
        const settings = await loadSettings();
        const [templates, repoInstructions] = await Promise.all([
          readIssueTemplates(repoPath).catch(() => [] as string[]),
          readRepoInstructions(repoPath),
        ]);

        const { system, prompt } = buildIssueDraftPrompt({
          notes: opts.notes,
          templates,
          repoName: opts.repoName,
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

        const draft = extractIssueDraft(buffer);
        if (draft.body.trim()) opts.onResult(draft);
        else toast.error("Couldn't draft an issue — try again.");
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
