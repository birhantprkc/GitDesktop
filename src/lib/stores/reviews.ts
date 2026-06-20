import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { cancelAgentReview } from "@/lib/ai/agent";
import { createAiClient } from "@/lib/ai/client";
import { buildReviewPrompt } from "@/lib/ai/prompt";
import { isCliProvider, isLocalProvider } from "@/lib/ai/providers";
import { runCliStream } from "@/lib/ai/stream";
import type { AiSettings, ReviewDeltaState, ReviewMode } from "@/lib/ai/types";
import { gitDiffBetweenRefs, gitFetchObjects } from "@/lib/git/api";
import type { DiffStatEntry } from "@/lib/git/types";
import { notifyIfUnfocused } from "@/lib/notify";
import { getLatestReview, saveReview } from "@/lib/pulls/reviews-history";
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
  /** Accumulated markdown of the (possibly in-progress) review. */
  text: string;
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
  text: "",
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

/** Upper bound on the delta fetched from git; the prompt budget trims further. */
const DELTA_MAX_BYTES = 200_000;

/** What `buildReviewPrompt` needs about a prior review of the same PR + mode. */
interface PriorContext {
  priorFindings?: string;
  priorReviewedAt?: number;
  deltaDiffText?: string;
  deltaTruncated?: boolean;
  deltaState?: ReviewDeltaState;
}

/**
 * Loads the previous review for this PR + mode (if any) and computes a two-dot
 * delta of what changed since. All SOFT and best-effort: a missing prior, an
 * un-fetched remote SHA, a rewritten branch, or any git failure degrades to
 * "prior findings without a delta" (or nothing) — it never blocks the review.
 * The full current diff stays the authoritative source of truth.
 *
 * Note: remote PRs not checked out locally land on `indeterminate` (the head
 * SHA isn't a local object). A best-effort `git fetch` of the two SHAs is the
 * planned fast-follow to make the remote delta resolve.
 */
async function resolvePriorContext(
  target: ReviewTarget,
  mode: ReviewMode,
  currentHeadSha: string | undefined,
): Promise<PriorContext> {
  const prior = await getLatestReview(
    target.repoPath,
    target.kind,
    target.ref,
    mode,
  );
  if (!prior?.text.trim()) return {};
  const base: PriorContext = {
    priorFindings: prior.text,
    priorReviewedAt: prior.finishedAt,
  };
  if (!currentHeadSha || !prior.headSha) {
    return { ...base, deltaState: "indeterminate" };
  }
  if (currentHeadSha === prior.headSha) {
    // Head unchanged — but the authoritative (merge-base-relative) diff can still
    // differ if the base moved, so we never treat this as a no-op here.
    return { ...base, deltaState: "head-unchanged" };
  }
  try {
    if (target.kind === "remote") {
      // A remote PR may never have been checked out, so its commits aren't local
      // objects (gh pr diff fetches nothing). Best-effort fetch the two SHAs so
      // the delta can resolve; ignore failure — the diff falls back gracefully.
      await gitFetchObjects(target.repoPath, [
        prior.headSha,
        currentHeadSha,
      ]).catch(() => undefined);
    }
    const delta = await gitDiffBetweenRefs(
      target.repoPath,
      prior.headSha,
      currentHeadSha,
      DELTA_MAX_BYTES,
    );
    if (delta.reason === "ok") {
      return {
        ...base,
        deltaDiffText: delta.text,
        deltaTruncated: delta.truncated,
        deltaState: "ok",
      };
    }
    if (delta.reason === "rewritten") {
      return { ...base, deltaState: "rewritten" };
    }
    // "missing" (un-fetched remote SHA) and "indeterminate" (shallow clone) both
    // mean "no usable delta" — carry the prior findings, drop the delta.
    return { ...base, deltaState: "indeterminate" };
  } catch {
    return { ...base, deltaState: "indeterminate" };
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
 * along as soft, re-verifiable context (unless `ignorePrior`); the result is
 * persisted on success so the NEXT run can build on it.
 */
export async function startReview(
  target: ReviewTarget,
  title: string,
  ai: AiSettings,
  mode: ReviewMode,
  context: ReviewContext,
  ignorePrior = false,
): Promise<void> {
  const key = reviewKey(target);
  // Single-flight per key — the UI hides the run buttons while generating, but
  // guard against a double-fire racing two streams into one entry (a queued run
  // counts as already-started).
  const phase = useReviewStore.getState().entries[key]?.phase;
  if (phase === "running" || phase === "queued") return;

  const patch = (p: Partial<ReviewEntry>) =>
    useReviewStore.getState().patch(key, p);
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
  patch({
    phase: "queued",
    text: "",
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
      : await resolvePriorContext(target, mode, context.headSha);
    if (control.cancelled) return;
    patch({ deltaState: prior.deltaState });
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
      },
      mode,
    );

    if (isCliProvider(ai.provider)) {
      await runCliStream({
        ai,
        system,
        prompt,
        repoPath: context.repoPath,
        headSha: context.headSha,
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
    void notifyReviewDone(title, mode, true);
    // Persist the finished review so the NEXT run can use it as soft context.
    // The final text is read from the store (covers both the CLI and HTTP
    // paths); a cancelled run returns above, so no mid-stream fragment is ever
    // stored. Best-effort — a persistence failure must not surface to the user.
    const finalText = useReviewStore.getState().entries[key]?.text ?? "";
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
  const generate = useCallback(
    (
      ai: AiSettings,
      mode: ReviewMode,
      context: ReviewContext,
      ignorePrior?: boolean,
    ) => {
      void startReview(target, context.title, ai, mode, context, ignorePrior);
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
    deltaState: entry.deltaState,
  };
}
