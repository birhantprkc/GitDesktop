import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { cancelAgentReview } from "@/lib/ai/agent";
import { createAiClient } from "@/lib/ai/client";
import { buildReviewPrompt } from "@/lib/ai/prompt";
import { isCliProvider } from "@/lib/ai/providers";
import { runCliStream } from "@/lib/ai/stream";
import type { AiSettings, ReviewMode } from "@/lib/ai/types";
import type { DiffStatEntry } from "@/lib/git/types";

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

/** Identifies the PR a review belongs to — also the dock's "View" target. */
export interface ReviewTarget {
  kind: "remote" | "local";
  repoPath: string;
  repoName: string;
  /** Remote PR number (as a string) or local PR id. */
  ref: string;
}

export type ReviewPhase = "idle" | "running" | "done" | "error" | "cancelled";

/** State of one review run, keyed by repo + PR in the store. */
export interface ReviewEntry {
  phase: ReviewPhase;
  /** Accumulated markdown of the (possibly in-progress) review. */
  text: string;
  /** Transient sub-status line shown while a CLI agent works. */
  status: string;
  /** The mode of the run that produced `text` (drives the "post" label). */
  mode: ReviewMode;
  /** The model the run used, captured so the posted label stays accurate. */
  model: string;
  /** PR title — the activity dock's row label. */
  title: string;
  /** Where the run came from — drives the dock's "View" navigation. */
  target: ReviewTarget;
  /** Wall-clock start, for newest-first ordering in the dock. */
  startedAt: number;
  /** Failure message when `phase === "error"`. */
  error: string;
}

/** A store entry tagged with its key — what the activity dock renders. */
export interface ReviewTask extends ReviewEntry {
  key: string;
}

const EMPTY_TARGET: ReviewTarget = {
  kind: "remote",
  repoPath: "",
  repoName: "",
  ref: "",
};

const EMPTY_ENTRY: ReviewEntry = {
  phase: "idle",
  text: "",
  status: "",
  mode: "general",
  model: "",
  title: "",
  target: EMPTY_TARGET,
  startedAt: 0,
  error: "",
};

/** Stable store key for a review run. */
export function reviewKey(t: {
  kind: string;
  repoPath: string;
  ref: string;
}): string {
  return `${t.kind}:${t.repoPath}#${t.ref}`;
}

interface ReviewStore {
  entries: Record<string, ReviewEntry>;
  patch: (key: string, p: Partial<ReviewEntry>) => void;
  remove: (key: string) => void;
}

const useReviewStore = create<ReviewStore>((set) => ({
  entries: {},
  patch: (key, p) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [key]: { ...(s.entries[key] ?? EMPTY_ENTRY), ...p },
      },
    })),
  remove: (key) =>
    set((s) => {
      if (!(key in s.entries)) return s;
      const next = { ...s.entries };
      delete next[key];
      return { entries: next };
    }),
}));

/**
 * Non-render run handles, kept outside the store so streaming deltas don't
 * thrash it. One entry exists per *in-flight* run; it's removed on settle.
 */
interface RunControl {
  abort: AbortController | null;
  cliReviewId: string | null;
  cancelled: boolean;
}

const controls = new Map<string, RunControl>();

/**
 * Starts an AI review (general or security) for a PR, keyed so the run is
 * decoupled from the view that triggered it. The run, its result, and its
 * Cancel affordance all survive navigating away — the run lives in this module
 * + the store (surfaced by the activity dock), not in a component. Routes to
 * the Vercel AI SDK for HTTP providers or a local agent CLI for CLI providers.
 */
export async function startReview(
  target: ReviewTarget,
  title: string,
  ai: AiSettings,
  mode: ReviewMode,
  context: ReviewContext,
): Promise<void> {
  const key = reviewKey(target);
  // Single-flight per key — the UI hides the run buttons while generating, but
  // guard against a double-fire racing two streams into one entry.
  if (useReviewStore.getState().entries[key]?.phase === "running") return;

  const patch = (p: Partial<ReviewEntry>) =>
    useReviewStore.getState().patch(key, p);
  // Register the run and flip to "running" before any async work, so the
  // single-flight guard above stays atomic even if an `await` is added here.
  const control: RunControl = {
    abort: null,
    cliReviewId: null,
    cancelled: false,
  };
  controls.set(key, control);
  patch({
    phase: "running",
    text: "",
    status: "",
    mode,
    model: ai.model,
    title,
    target,
    startedAt: Date.now(),
    error: "",
  });

  try {
    const diff = await context.loadDiff();
    if (control.cancelled) return;
    if (!diff.text.trim()) {
      // A no-op run shouldn't linger in the dock; a momentary toast is enough.
      toast.info("No changes to review.");
      useReviewStore.getState().remove(key);
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
        setText: (t) => patch({ text: t }),
        setStatus: (s) => patch({ status: s }),
        registerId: (id) => {
          control.cliReviewId = id;
        },
      });
    } else {
      const abort = new AbortController();
      control.abort = abort;
      const client = await createAiClient(ai);
      let buffer = "";
      for await (const chunk of client.stream({
        system,
        prompt,
        abortSignal: abort.signal,
      })) {
        buffer += chunk;
        patch({ text: buffer });
      }
    }
    if (control.cancelled) return;
    patch({ phase: "done", status: "" });
  } catch (e) {
    if (!control.cancelled) {
      patch({
        phase: "error",
        status: "",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } finally {
    // Only the owning run releases its handle — a cancel may have replaced us.
    if (controls.get(key) === control) controls.delete(key);
  }
}

/**
 * Cancels an in-flight run for `key`. HTTP providers stop via the AbortSignal;
 * CLI providers stop by killing the subprocess. Keeps whatever streamed so far
 * and marks the run cancelled. Safe to call when nothing is running.
 */
export function cancelReview(key: string): void {
  const control = controls.get(key);
  if (!control || control.cancelled) return;
  control.cancelled = true;
  control.abort?.abort();
  if (control.cliReviewId) {
    cancelAgentReview(control.cliReviewId).catch(() => undefined);
  }
  useReviewStore.getState().patch(key, { phase: "cancelled", status: "" });
  controls.delete(key);
}

/** Clears a finished review's text — used after posting it as a comment. */
export function resetReview(key: string): void {
  useReviewStore.getState().remove(key);
}

/** Removes a finished run from the activity dock. */
export function dismissReview(key: string): void {
  useReviewStore.getState().remove(key);
}

/** The runs the activity dock shows, newest first (dismissing removes them). */
export function useReviewTasks(): ReviewTask[] {
  const entries = useReviewStore((s) => s.entries);
  return useMemo(
    () =>
      Object.entries(entries)
        .map(([key, e]) => ({ key, ...e }))
        .sort((a, b) => b.startedAt - a.startedAt),
    [entries],
  );
}

/**
 * Binds a PR's review run to a component. Reading goes through the keyed store,
 * so the run keeps streaming into the store even while this component is
 * unmounted; remounting re-attaches to the live (or finished) result.
 */
export function useReviewRun(target: ReviewTarget) {
  const key = reviewKey(target);
  const entry = useReviewStore((s) => s.entries[key]) ?? EMPTY_ENTRY;
  const generate = useCallback(
    (ai: AiSettings, mode: ReviewMode, context: ReviewContext) => {
      void startReview(target, context.title, ai, mode, context);
    },
    [target],
  );
  const cancel = useCallback(() => cancelReview(key), [key]);
  const reset = useCallback(() => resetReview(key), [key]);
  return {
    generate,
    cancel,
    reset,
    generating: entry.phase === "running",
    text: entry.text,
    status: entry.status,
    mode: entry.mode,
    model: entry.model,
  };
}
