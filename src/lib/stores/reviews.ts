import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { cancelAgentReview } from "@/lib/ai/agent";
import {
  type ExternalContext,
  resolveExternalContext,
} from "@/lib/ai/external-context";
import { type PriorContext, resolvePriorContext } from "@/lib/ai/prior-context";
import { buildReviewPrompt } from "@/lib/ai/prompt";
import { isLocalProvider } from "@/lib/ai/providers";
import { streamAi } from "@/lib/ai/stream";
import type { AiSettings, ReviewDeltaState, ReviewMode } from "@/lib/ai/types";
import type { DiffStatEntry } from "@/lib/git/types";
import { notifyIfUnfocused } from "@/lib/notify";
import { saveReview } from "@/lib/pulls/reviews-history";
import { queryClient } from "@/lib/query-client";
import { loadSettings } from "@/lib/settings/api";

export interface ReviewContext {
  title: string;
  body: string;
  commitSubjects: string[];
  /** Repo working directory — the CLI agent runs here. */
  repoPath: string;
  /** Current PR head SHA. Persisted with the review so the NEXT run can compute
   *  a "changes since" delta against it; absent for views that don't supply it. */
  headSha?: string;
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

export type ReviewPhase =
  | "idle"
  | "queued"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** State of one review run, keyed by repo + PR in the store. */
export interface ReviewEntry {
  phase: ReviewPhase;
  /** Transient sub-status line shown while a CLI agent works. */
  status: string;
  /** The mode of the run that produced `text` (drives the "post" label). */
  mode: ReviewMode;
  /** The model the run used, captured so the posted label stays accurate. */
  model: string;
  /** Whether this run is machine-bound (CLI agent subprocess or local Ollama)
   *  vs a cloud HTTP provider — picks its concurrency lane and groups its queue
   *  position. */
  local: boolean;
  /** PR title — the activity dock's row label. */
  title: string;
  /** Where the run came from — drives the dock's "View" navigation. */
  target: ReviewTarget;
  /** Monotonic start order — drives newest-first display and FIFO queue
   *  position exactly (a timestamp can collide within a millisecond). */
  seq: number;
  /** Failure message when `phase === "error"`. */
  error: string;
  /** When the run used prior-review context, how its "changes since" delta
   *  resolved — drives the panel's rewrite/indeterminate note. Undefined on a
   *  first run or when prior context was ignored. */
  deltaState?: ReviewDeltaState;
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
  status: "",
  mode: "general",
  model: "",
  local: false,
  title: "",
  target: EMPTY_TARGET,
  seq: 0,
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
  /** In-flight review markdown, kept OUT of `entries` so the per-token streaming
   *  updates don't churn the dock-facing entry map (the activity dock renders
   *  metadata only — never the text — so it shouldn't re-render per token). */
  texts: Record<string, string>;
  patch: (key: string, p: Partial<ReviewEntry>) => void;
  setText: (key: string, text: string) => void;
  remove: (key: string) => void;
}

const useReviewStore = create<ReviewStore>((set) => ({
  entries: {},
  texts: {},
  patch: (key, p) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [key]: { ...(s.entries[key] ?? EMPTY_ENTRY), ...p },
      },
    })),
  setText: (key, text) => set((s) => ({ texts: { ...s.texts, [key]: text } })),
  remove: (key) =>
    set((s) => {
      if (!(key in s.entries) && !(key in s.texts)) return s;
      const entries = { ...s.entries };
      delete entries[key];
      const texts = { ...s.texts };
      delete texts[key];
      return { entries, texts };
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
  /** Whether this run currently holds a concurrency slot. */
  hasSlot: boolean;
  /** While queued, resolves the slot wait so the run can start or unwind. */
  wakeQueued: (() => void) | null;
  /** The lane this run draws its slot from (for release + queue removal). */
  lane: Limiter | null;
}

const controls = new Map<string, RunControl>();

/** Monotonic counter stamped on each run for exact start-order display. */
let reviewSeq = 0;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Two independent concurrency lanes so kicking off reviews on several PRs at
 * once doesn't overload the machine. Runs over a lane's cap enter the `queued`
 * phase and start FIFO as slots free up; the lanes are separate so a local
 * backlog never blocks a cloud run (or vice versa).
 *
 * - The **local** lane (CLI agent subprocesses + local Ollama inference) is
 *   bound by the machine, so its cap scales conservatively with CPU cores.
 * - The **cloud** lane (Anthropic/OpenAI/OpenRouter streaming) spawns no
 *   process and isn't machine-bound, so it's far higher — its real ceiling is
 *   the provider's own rate limit, which is the user's to manage.
 */
interface Limiter {
  max: number;
  active: number;
  waiting: RunControl[];
}

const cores = Math.max(1, navigator.hardwareConcurrency || 4);
const localLane: Limiter = {
  max: clamp(Math.floor(cores / 2), 2, 8),
  active: 0,
  waiting: [],
};
const cloudLane: Limiter = {
  max: clamp(cores * 2, 8, 32),
  active: 0,
  waiting: [],
};

/** Reserves a slot in `lane`, resolving immediately if free or once one frees. */
function acquireSlot(lane: Limiter, control: RunControl): Promise<void> {
  if (lane.active < lane.max) {
    lane.active++;
    control.hasSlot = true;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    control.wakeQueued = () => {
      control.wakeQueued = null;
      resolve();
    };
    lane.waiting.push(control);
  });
}

/** Hands a freed slot to the next live waiter in `lane`, or frees it if none. */
function releaseSlot(lane: Limiter): void {
  while (lane.waiting.length > 0) {
    const next = lane.waiting.shift();
    if (!next || next.cancelled) continue; // cancelled waiters drop out
    next.hasSlot = true;
    next.wakeQueued?.();
    return; // slot handed off — lane.active unchanged
  }
  lane.active--;
}

/** OS notification when a review settles while the window is hidden (close to
 *  tray) or unfocused, gated on the user's setting. Best-effort. */
async function notifyReviewDone(
  title: string,
  mode: ReviewMode,
  ok: boolean,
): Promise<void> {
  try {
    const { notifications } = await loadSettings();
    if (!notifications.reviews) return;
    const label = mode === "security" ? "security audit" : "review";
    void notifyIfUnfocused(
      ok ? `AI ${label} ready` : `AI ${label} failed`,
      `"${title}"`,
    );
  } catch {
    // best-effort — a missed notification must never affect the review
  }
}

/**
 * Starts an AI review (general or security) for a PR, keyed so the run is
 * decoupled from the view that triggered it. The run, its result, and its
 * Cancel affordance all survive navigating away — the run lives in this module
 * + the store (surfaced by the activity dock), not in a component. Routes to
 * the Vercel AI SDK for HTTP providers or a local agent CLI for CLI providers.
 *
 * On a re-run, the PREVIOUS review's findings + a "changes since" delta ride
 * along as soft, re-verifiable context (unless `ignorePrior`); on a remote PR,
 * findings posted by third-party AI reviewers (Copilot/CodeRabbit) ride along
 * too (unless `ignoreExternal`). The result is persisted on success so the NEXT
 * run can build on it.
 */
export async function startReview(
  target: ReviewTarget,
  title: string,
  ai: AiSettings,
  mode: ReviewMode,
  context: ReviewContext,
  ignorePrior = false,
  ignoreExternal = false,
): Promise<void> {
  const key = reviewKey(target);
  // Single-flight per key — the UI hides the run buttons while generating, but
  // guard against a double-fire racing two streams into one entry (a queued run
  // counts as already-started).
  const phase = useReviewStore.getState().entries[key]?.phase;
  if (phase === "running" || phase === "queued") return;

  const patch = (p: Partial<ReviewEntry>) =>
    useReviewStore.getState().patch(key, p);
  const pushText = (t: string) => useReviewStore.getState().setText(key, t);
  const local = isLocalProvider(ai.provider);
  const lane = local ? localLane : cloudLane;
  // Register the run and mark it queued before any async work, so the
  // single-flight guard above stays atomic even if an `await` is added here.
  const control: RunControl = {
    abort: null,
    cliReviewId: null,
    cancelled: false,
    hasSlot: false,
    wakeQueued: null,
    lane,
  };
  controls.set(key, control);
  // Clear any text from a prior run on this key before the new stream appends.
  pushText("");
  patch({
    phase: "queued",
    status: "",
    mode,
    model: ai.model,
    local,
    title,
    target,
    seq: reviewSeq++,
    error: "",
    deltaState: undefined,
  });

  // Wall-clock start for the persisted history record (the store itself orders
  // by monotonic `seq`, not a timestamp).
  const startedAtMs = Date.now();

  // Wait for a slot in this run's lane (immediate when under the cap). A cancel
  // while queued wakes this too — `control.cancelled` then short-circuits below.
  await acquireSlot(lane, control);

  try {
    if (control.cancelled) return;
    patch({ phase: "running" });
    const diff = await context.loadDiff();
    if (control.cancelled) return;
    if (!diff.text.trim()) {
      // A no-op run shouldn't linger in the dock; a momentary toast is enough.
      toast.info("No changes to review.");
      useReviewStore.getState().remove(key);
      return;
    }
    // Soft prior-review context (skipped when the user asked to ignore it). Runs
    // on a held slot after the diff loads — never during the queued wait.
    const prior: PriorContext = ignorePrior
      ? {}
      : await resolvePriorContext(
          target.repoPath,
          target.kind,
          target.ref,
          mode,
          context.headSha,
        );
    if (control.cancelled) return;
    patch({ deltaState: prior.deltaState });
    // Third-party AI-reviewer findings on the remote PR (best-effort, remote-only,
    // skipped when ignored). Same soft-context framing as the prior review.
    const external: ExternalContext = await resolveExternalContext(
      target.repoPath,
      target.kind,
      target.ref,
      context.headSha,
      ignoreExternal,
    );
    if (control.cancelled) return;
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
        ...prior,
        ...external,
      },
      mode,
    );

    await streamAi({
      ai,
      system,
      prompt,
      repoPath: context.repoPath,
      headSha: context.headSha,
      setText: pushText,
      setStatus: (s) => patch({ status: s }),
      onCliId: (id) => {
        control.cliReviewId = id;
      },
      onAbort: (a) => {
        control.abort = a;
      },
    });
    if (control.cancelled) return;
    patch({ phase: "done", status: "" });
    void notifyReviewDone(title, mode, true);
    // Persist the finished review so the NEXT run can use it as soft context.
    // The final text is read from the store (covers both the CLI and HTTP
    // paths); a cancelled run returns above, so no mid-stream fragment is ever
    // stored. Best-effort — a persistence failure must not surface to the user.
    const finalText = useReviewStore.getState().texts[key] ?? "";
    if (finalText.trim()) {
      void saveReview(target.repoPath, {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        kind: target.kind,
        ref: target.ref,
        mode,
        model: ai.model,
        title,
        text: finalText,
        // Empty when the view supplied no head (degenerate no-commits state);
        // the next run then routes to the safe "indeterminate" delta path and
        // self-heals once a later review records a real SHA.
        headSha: context.headSha ?? "",
        startedAt: startedAtMs,
        finishedAt: Date.now(),
      })
        // Refresh the panel's history (banner + "Previous reviews") immediately,
        // not just on the next window focus / remount.
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: [
              "review-history",
              target.repoPath,
              target.kind,
              target.ref,
            ],
          }),
        )
        .catch(() => undefined);
    }
  } catch (e) {
    if (!control.cancelled) {
      patch({
        phase: "error",
        status: "",
        error: e instanceof Error ? e.message : String(e),
      });
      void notifyReviewDone(title, mode, false);
    }
  } finally {
    // Release the lane slot for the next queued run (only if this run actually
    // held one — a run cancelled while queued never did).
    if (control.hasSlot) {
      control.hasSlot = false;
      releaseSlot(lane);
    }
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
  // If it's still queued, pull it from its lane's queue and wake its slot-wait
  // so the run unwinds — it never took a slot, so there's nothing to release.
  if (control.wakeQueued && control.lane) {
    const i = control.lane.waiting.indexOf(control);
    if (i >= 0) control.lane.waiting.splice(i, 1);
    control.wakeQueued();
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
        .sort((a, b) => b.seq - a.seq),
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
  // Subscribed separately from `entry` so the per-token text updates re-render
  // only this panel, not the dock (which selects `entries`).
  const text = useReviewStore((s) => s.texts[key]) ?? "";
  const generate = useCallback(
    (
      ai: AiSettings,
      mode: ReviewMode,
      context: ReviewContext,
      ignorePrior?: boolean,
      ignoreExternal?: boolean,
    ) => {
      void startReview(
        target,
        context.title,
        ai,
        mode,
        context,
        ignorePrior,
        ignoreExternal,
      );
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
    text,
    status: entry.status,
    mode: entry.mode,
    model: entry.model,
    deltaState: entry.deltaState,
  };
}
