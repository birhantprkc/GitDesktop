import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { cancelAgentReview } from "@/lib/ai/agent";
import { createAiClient } from "@/lib/ai/client";
import { buildReviewPrompt } from "@/lib/ai/prompt";
import { isCliProvider } from "@/lib/ai/providers";
import { runCliStream } from "@/lib/ai/stream";
import type { AiSettings, ReviewMode } from "@/lib/ai/types";
import type { DiffStatEntry } from "@/lib/git/types";
import { toastError } from "@/lib/toast";

export interface ReviewContext {
  title: string;
  body: string;
  commitSubjects: string[];
  /** Repo working directory — the CLI agent runs here. */
  repoPath: string;
  /** Lazily fetch the combined diff (only when a review is actually run). */
  loadDiff: () => Promise<{
    text: string;
    truncated: boolean;
    files: DiffStatEntry[];
  }>;
}

/**
 * Streams an AI review (general or security) of a PR's diff. Routes to the
 * Vercel AI SDK for HTTP providers, or to a local agent CLI subprocess for
 * CLI providers (claude-cli). The accumulated markdown is exposed as `text`.
 */
export function useGenerateReview() {
  const [generating, setGenerating] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const cliReviewIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    if (cliReviewIdRef.current) {
      // Best-effort; the run already tears down on the backend.
      cancelAgentReview(cliReviewIdRef.current).catch(() => undefined);
    }
  }, []);

  const reset = useCallback(() => setText(""), []);

  const generate = useCallback(
    async (ai: AiSettings, mode: ReviewMode, context: ReviewContext) => {
      cancelledRef.current = false;
      setGenerating(true);
      setText("");
      setStatus("");
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

        if (isCliProvider(ai.provider)) {
          await runCliStream({
            ai,
            system,
            prompt,
            repoPath: context.repoPath,
            setText,
            setStatus,
            registerId: (id) => {
              cliReviewIdRef.current = id;
            },
          });
        } else {
          const abort = new AbortController();
          abortRef.current = abort;
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
        }
      } catch (e) {
        if (!cancelledRef.current) toastError(e);
      } finally {
        setGenerating(false);
        setStatus("");
        abortRef.current = null;
        cliReviewIdRef.current = null;
      }
    },
    [],
  );

  return { generate, cancel, reset, generating, text, status };
}
