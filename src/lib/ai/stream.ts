import { useCallback, useRef, useState } from "react";
import { gitRemoveWorktree, gitReviewWorktree } from "@/lib/git/api";
import { toastError } from "@/lib/toast";
import { cancelAgentReview, providerKind, runAgentReview } from "./agent";
import { createAiClient } from "./client";
import { isCliProvider } from "./providers";
import type { AiSettings } from "./types";

export interface CliStreamOpts {
  ai: AiSettings;
  system: string;
  prompt: string;
  /** Working directory the CLI agent runs in (also its repo-aware root). */
  repoPath: string;
  /** PR head SHA. When repo-aware and this isn't the active checkout, the agent
   *  runs in a throwaway detached worktree at this commit, so it reads the PR's
   *  files instead of the user's current branch. Removed when the run settles. */
  headSha?: string;
  setText: (text: string) => void;
  setStatus: (status: string) => void;
  registerId: (id: string) => void;
}

/**
 * Drives one streaming agent-CLI run, accumulating deltas into `setText`.
 * Shared by the PR review and the Actions "Debug with AI" flows.
 */
export async function runCliStream({
  ai,
  system,
  prompt,
  repoPath,
  headSha,
  setText,
  setStatus,
  registerId,
}: CliStreamOpts): Promise<void> {
  const kind = providerKind(ai.provider);
  if (!kind) throw new Error(`Unsupported CLI provider: ${ai.provider}`);

  const reviewId = crypto.randomUUID();
  registerId(reviewId);

  // Repo-aware reviews read files from the working tree. When the PR head isn't
  // the active checkout, run the agent in a throwaway detached worktree pinned at
  // that commit so it reads the PR's files, not the user's current branch.
  let cwd = repoPath;
  let worktree: string | null = null;
  if (ai.cliRepoAware && headSha) {
    setStatus("Preparing review workspace…");
    worktree = await gitReviewWorktree(repoPath, headSha).catch(() => null);
    if (worktree) cwd = worktree;
  }

  try {
    let buffer = "";
    let settled = false;
    await new Promise<void>((resolve, reject) => {
      runAgentReview({
        kind,
        binPath: ai.cliPath?.trim() || null,
        model: ai.model,
        systemPrompt: system,
        userPrompt: prompt,
        repoPath: cwd,
        repoAware: Boolean(ai.cliRepoAware),
        reviewId,
        onEvent: (event) => {
          if (event.kind === "delta") {
            buffer += event.text;
            setText(buffer);
          } else if (event.kind === "status") {
            setStatus(event.text);
          } else if (event.kind === "done") {
            settled = true;
            // The terminal event carries the authoritative full text; prefer it
            // if the partial stream fell short (e.g. deltas were coalesced).
            if (event.text.length > buffer.length) setText(event.text);
            if (event.isError)
              reject(new Error("The run ended with an error."));
            else resolve();
          } else {
            settled = true;
            reject(new Error(event.message));
          }
        },
      })
        // Backend returned without a terminal event — the cancel path.
        .then(() => {
          if (!settled) resolve();
        })
        .catch(reject);
    });
  } finally {
    // Tear down the ephemeral worktree on every exit (done/cancel/error).
    if (worktree) {
      void gitRemoveWorktree(repoPath, worktree).catch(() => undefined);
    }
  }
}

export interface RunStreamArgs {
  system: string;
  prompt: string;
  repoPath: string;
}

/**
 * Generic streaming-AI hook: routes a system+prompt to an HTTP provider (Vercel
 * AI SDK) or a CLI agent subprocess, accumulating the response into `text`.
 * `repoPath` is only used by CLI providers.
 */
export function useAiTextStream() {
  const [generating, setGenerating] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const cliIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    if (cliIdRef.current) {
      cancelAgentReview(cliIdRef.current).catch(() => undefined);
    }
  }, []);

  const reset = useCallback(() => {
    setText("");
    setStatus("");
  }, []);

  const run = useCallback(async (ai: AiSettings, args: RunStreamArgs) => {
    cancelledRef.current = false;
    setGenerating(true);
    setText("");
    setStatus("");
    try {
      if (isCliProvider(ai.provider)) {
        await runCliStream({
          ai,
          system: args.system,
          prompt: args.prompt,
          repoPath: args.repoPath,
          setText,
          setStatus,
          registerId: (id) => {
            cliIdRef.current = id;
          },
        });
      } else {
        const abort = new AbortController();
        abortRef.current = abort;
        const client = await createAiClient(ai);
        let buffer = "";
        for await (const chunk of client.stream({
          system: args.system,
          prompt: args.prompt,
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
      cliIdRef.current = null;
    }
  }, []);

  return { run, cancel, reset, generating, text, status };
}
