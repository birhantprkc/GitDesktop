import { toast } from "sonner";
import { create } from "zustand";
import { cancelAgentSession, runAgentSession } from "@/lib/ai/agent";
import {
  commitWorktreeAll,
  createWorktree,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  squashWorktree,
} from "@/lib/git/worktree";
import { toastError } from "@/lib/toast";
import { loadPersistedSessions, persistSessions } from "./persistence";

export type TurnStatus = "running" | "committing" | "done" | "error";

/** One round-trip in a session: the user's message + the agent's response, and
 *  the per-turn checkpoint commit it produced. */
export interface SessionTurn {
  prompt: string;
  /** Streamed assistant narration for this turn. */
  narration: string;
  status: TurnStatus;
  /** Transient tool-activity note while running. */
  statusText: string;
  /** This turn's checkpoint commit (null = the turn changed nothing). */
  commitHash: string | null;
  costUsd: number | null;
  error: string | null;
}

export interface AgentSession {
  /** Stable id (the worktree dir name + branch suffix). */
  id: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  /** Commit the worktree was created from — base for the cumulative diff. */
  base: string;
  /** Latest checkpoint commit (= base until the first turn commits). */
  headHash: string;
  /** Claude session uuid: `--session-id` on turn 1, `--resume` after; also the cancel key. */
  claudeSessionId: string;
  /** Current model for the next turn ("" = account default). Changeable mid-session. */
  model: string;
  /** A turn is currently streaming for THIS session (sessions run independently). */
  running: boolean;
  turns: SessionTurn[];
}

const SYSTEM_PROMPT =
  "You are an autonomous coding agent working inside an isolated, throwaway git " +
  "worktree — a separate checkout, so you cannot affect the user's main working " +
  "tree or branch. Implement the user's request directly by editing files in the " +
  "current directory. This is a continuing conversation: later messages refine or " +
  "build on your earlier work in this same worktree. Make focused, working changes. " +
  "Do NOT commit — the app commits each turn so the user can review it. When " +
  "finished with a turn, briefly summarize what you changed.";

interface SessionsState {
  /** All sessions, in creation order. Each runs in its own worktree. */
  sessions: AgentSession[];
  /** The session shown in the main canvas; null = the "new session" composer. */
  activeId: string | null;
  /** A new session's worktree is being created. */
  creating: boolean;
  /** The session currently being kept/discarded (its actions are disabled). */
  busyId: string | null;
  /** Whether persisted sessions have been loaded + reconciled (gates persisting). */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setActive: (id: string | null) => void;
  start: (repoPath: string, prompt: string, model: string) => Promise<void>;
  send: (id: string, prompt: string) => Promise<void>;
  setModel: (id: string, model: string) => void;
  cancel: (id: string) => Promise<void>;
  keep: (id: string, squash: boolean) => Promise<void>;
  discard: (id: string) => Promise<void>;
}

function newTurn(prompt: string): SessionTurn {
  return {
    prompt,
    narration: "",
    status: "running",
    statusText: "Starting the agent…",
    commitHash: null,
    costUsd: null,
    error: null,
  };
}

type Get = () => SessionsState;
type SetState = (partial: Partial<SessionsState>) => void;

/** Normalize a path for comparison (git reports forward slashes; Windows paths
 *  arrive with backslashes, and are case-insensitive). */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/** A session loaded from disk can't have a live turn — its CLI process is gone.
 *  Mark a mid-run turn as interrupted so the session is idle (resumes on the
 *  next message). */
function markInterrupted(s: AgentSession): AgentSession {
  const i = s.turns.length - 1;
  const last = s.turns[i];
  if (
    !s.running &&
    !(last?.status === "running" || last?.status === "committing")
  )
    return { ...s, running: false };
  const turns = s.turns.slice();
  if (last)
    turns[i] = {
      ...last,
      status: last.status === "done" ? "done" : "error",
      error:
        last.status === "running" || last.status === "committing"
          ? "Interrupted by restart."
          : last.error,
      statusText: "",
    };
  return { ...s, running: false, turns };
}

/** Removes a session from the list, moving `activeId` to a survivor (or null). */
function removeSession(get: Get, set: SetState, id: string) {
  const remaining = get().sessions.filter((s) => s.id !== id);
  const activeId =
    get().activeId === id
      ? (remaining[remaining.length - 1]?.id ?? null)
      : get().activeId;
  set({ sessions: remaining, activeId, busyId: null });
}

/**
 * Runs session `id`'s LAST (already-appended) turn: streams the agent into it,
 * then commits the turn as a checkpoint. Each `set` maps over the CURRENT
 * sessions array and touches only this id, so concurrent sessions don't clobber
 * each other. Every write re-checks the session still exists (it may have been
 * discarded mid-stream).
 */
async function runTurn(
  get: Get,
  set: SetState,
  id: string,
  prompt: string,
  resume: boolean,
) {
  const find = () => get().sessions.find((s) => s.id === id);
  const s0 = find();
  if (!s0) return;
  const { claudeSessionId, worktreePath, model } = s0;

  const setSession = (updater: (s: AgentSession) => AgentSession) =>
    set({
      sessions: get().sessions.map((s) => (s.id === id ? updater(s) : s)),
    });
  const patchTurn = (p: Partial<SessionTurn>) =>
    setSession((s) => {
      if (s.turns.length === 0) return s;
      const turns = s.turns.slice();
      turns[turns.length - 1] = { ...turns[turns.length - 1], ...p };
      return { ...s, turns };
    });

  setSession((s) => ({ ...s, running: true }));
  try {
    await runAgentSession({
      binPath: null,
      model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: prompt,
      worktreePath,
      sessionId: claudeSessionId,
      resume,
      onEvent: (ev) => {
        const s = find();
        if (!s) return;
        const last = s.turns[s.turns.length - 1];
        if (!last) return;
        if (ev.kind === "delta")
          patchTurn({ narration: last.narration + ev.text, statusText: "" });
        else if (ev.kind === "status") patchTurn({ statusText: ev.text });
        else if (ev.kind === "error")
          patchTurn({ status: "error", error: ev.message, statusText: "" });
        else if (ev.kind === "done")
          patchTurn({
            costUsd: ev.costUsd,
            statusText: "",
            ...(ev.isError
              ? {
                  status: "error",
                  error: last.narration || "The agent reported an error.",
                }
              : {}),
          });
      },
    });
  } catch (e) {
    patchTurn({ status: "error", error: String(e), statusText: "" });
    setSession((s) => ({ ...s, running: false }));
    return;
  }

  const s1 = find();
  if (!s1) return;
  if (s1.turns[s1.turns.length - 1]?.status === "error") {
    setSession((s) => ({ ...s, running: false }));
    return;
  }
  patchTurn({ status: "committing", statusText: "Committing this turn…" });
  try {
    const msg = prompt.split("\n")[0].slice(0, 72).trim() || "Agent turn";
    const hash = await commitWorktreeAll(worktreePath, msg);
    setSession((s) => {
      const turns = s.turns.slice();
      turns[turns.length - 1] = {
        ...turns[turns.length - 1],
        status: "done",
        statusText: "",
        commitHash: hash,
      };
      return { ...s, running: false, turns, headHash: hash ?? s.headHash };
    });
  } catch (e) {
    patchTurn({ status: "error", error: String(e), statusText: "" });
    setSession((s) => ({ ...s, running: false }));
  }
}

/**
 * Concurrent, multi-turn agent sessions: each runs full-auto in its own
 * throwaway worktree, streaming independently. Start a session → run turns
 * (each resumes the prior context, commits a checkpoint) → Keep (optionally
 * squashing the per-turn commits) or Discard.
 */
export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  creating: false,
  busyId: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    let persisted: AgentSession[] = [];
    try {
      persisted = await loadPersistedSessions();
    } catch {
      // No store yet / unreadable — start clean.
    }
    if (persisted.length) {
      const idled = persisted.map(markInterrupted);
      // Reconcile per repo: prune orphan admin entries, then keep only sessions
      // whose worktree still exists on disk (a crash/reload may have left some).
      const repos = [...new Set(idled.map((s) => s.repoPath))];
      const live: Record<string, Set<string>> = {};
      for (const repo of repos) {
        try {
          await pruneWorktrees(repo);
          const list = await listWorktrees(repo);
          live[repo] = new Set(list.map((w) => normPath(w.path)));
        } catch {
          // Repo unreadable/gone → its sessions drop out (no entry in `live`).
        }
      }
      const alive = idled.filter((s) =>
        live[s.repoPath]?.has(normPath(s.worktreePath)),
      );
      set({ sessions: alive });
    }
    set({ hydrated: true });
  },

  setActive: (id) => set({ activeId: id }),

  start: async (repoPath, prompt, model) => {
    const task = prompt.trim();
    if (!task || get().creating) return;
    set({ creating: true });
    let wt: Awaited<ReturnType<typeof createWorktree>>;
    try {
      wt = await createWorktree(repoPath);
    } catch (e) {
      toastError(e);
      set({ creating: false });
      return;
    }
    const session: AgentSession = {
      id: wt.id,
      repoPath,
      worktreePath: wt.path,
      branch: wt.branch,
      base: wt.base,
      headHash: wt.base,
      claudeSessionId: crypto.randomUUID(),
      model,
      running: false,
      turns: [newTurn(task)],
    };
    set({
      creating: false,
      sessions: [...get().sessions, session],
      activeId: wt.id,
    });
    await runTurn(get, set, wt.id, task, false);
  },

  send: async (id, prompt) => {
    const s = get().sessions.find((x) => x.id === id);
    if (!s || s.running) return;
    const task = prompt.trim();
    if (!task) return;
    set({
      sessions: get().sessions.map((x) =>
        x.id === id ? { ...x, turns: [...x.turns, newTurn(task)] } : x,
      ),
    });
    await runTurn(get, set, id, task, true);
  },

  setModel: (id, model) =>
    set({
      sessions: get().sessions.map((s) => (s.id === id ? { ...s, model } : s)),
    }),

  cancel: async (id) => {
    const s = get().sessions.find((x) => x.id === id);
    if (!s || !s.running) return;
    try {
      await cancelAgentSession(s.claudeSessionId);
    } catch (e) {
      toastError(e);
    }
    set({
      sessions: get().sessions.map((x) => {
        if (x.id !== id) return x;
        const turns = x.turns.slice();
        const i = turns.length - 1;
        if (
          i >= 0 &&
          (turns[i].status === "running" || turns[i].status === "committing")
        )
          turns[i] = {
            ...turns[i],
            status: "error",
            error: "Cancelled.",
            statusText: "",
          };
        return { ...x, running: false, turns };
      }),
    });
  },

  keep: async (id, squash) => {
    const s = get().sessions.find((x) => x.id === id);
    if (!s || s.running || get().busyId) return;
    set({ busyId: id });
    try {
      if (squash && s.headHash !== s.base) {
        const msg =
          s.turns[0]?.prompt.split("\n")[0].slice(0, 72).trim() ||
          "Agent session";
        await squashWorktree(s.worktreePath, s.base, msg);
      }
      // Keep the branch (its commit holds the work); drop only the worktree dir.
      await removeWorktree(s.repoPath, s.worktreePath, null, false);
      toast.success(`Kept on branch ${s.branch}`);
      removeSession(get, set, id);
    } catch (e) {
      toastError(e);
      set({ busyId: null });
    }
  },

  discard: async (id) => {
    const s = get().sessions.find((x) => x.id === id);
    if (!s || s.running || get().busyId) return;
    set({ busyId: id });
    try {
      await removeWorktree(s.repoPath, s.worktreePath, s.branch, true);
      removeSession(get, set, id);
    } catch (e) {
      toastError(e);
      set({ busyId: null });
    }
  },
}));

// Persist the sessions list (debounced) whenever it changes — but only after
// hydrate has loaded the existing ones, so a pre-hydrate change can't clobber
// the store with an empty list before it's read.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
useSessionsStore.subscribe((state) => {
  if (!state.hydrated) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistSessions(useSessionsStore.getState().sessions);
  }, 500);
});

// Load persisted sessions + reconcile orphaned worktrees once at startup.
// (Sessions survive a reload/restart: their worktrees + Claude transcripts live
// on disk, so a follow-up message resumes right where it left off.)
void useSessionsStore.getState().hydrate();
