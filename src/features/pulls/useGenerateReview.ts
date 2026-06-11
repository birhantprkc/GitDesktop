import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createAiClient } from "@/lib/ai/client";
import { buildReviewPrompt } from "@/lib/ai/prompt";
import type { AiSettings, ReviewMode } from "@/lib/ai/types";
import type { DiffStatEntry } from "@/lib/git/types";
import { toastError } from "@/lib/toast";

export interface ReviewContext {
  title: string;
  body: string;
  commitSubjects: string[];
  /** Lazily fetch the combined diff (only when a review is actually run). */
  loadDiff: () => Promise<{
    text: string;
    truncated: boolean;
    files: DiffStatEntry[];
  }>;
}

/**
 * Streams an AI review (general or security) of a PR's diff using the chosen
 * provider/model. The accumulated markdown is exposed as `text`.
 */
export function useGenerateReview() {
  const [generating, setGenerating] = useState(false);
  const [text, setText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => setText(""), []);

  const generate = useCallback(
    async (ai: AiSettings, mode: ReviewMode, context: ReviewContext) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setGenerating(true);
      setText("");
      try {
        const diff = await context.loadDiff();
        if (!diff.text.trim()) {
          toast.error("No changes to review.");
          return;
        }
        const { system, prompt } = buildReviewPrompt(
          {
            title: context.title,
            body: context.body,
            commitSubjects: context.commitSubjects,
            diffText: diff.text,
            diffTruncated: diff.truncated,
            files: diff.files.map((f) => ({
              path: f.path,
              added: f.added,
              deleted: f.deleted,
              isBinary: f.isBinary,
            })),
          },
          mode,
        );

        const client = await createAiClient(ai);
        let buffer = "";
        for await (const chunk of client.stream({
          system,
          prompt,
          abortSignal: abort.signal,
        })) {
          buffer += chunk;
          setText(buffer);
        }
      } catch (e) {
        if (!abort.signal.aborted) toastError(e);
      } finally {
        setGenerating(false);
        abortRef.current = null;
      }
    },
    [],
  );

  return { generate, cancel, reset, generating, text };
}
