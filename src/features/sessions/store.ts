import { toast } from "sonner";
import { create } from "zustand";
import { cancelAgentSession, runAgentSession } from "@/lib/ai/agent";
import {
  commitWorktreeAll,
  createWorktree,
  removeWorktree,
  squashWorktree,
} from "@/lib/git/worktree";
import { toastError } from "@/lib/toast";

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
  repoPath: string;
  worktreePath: string;
  branch: string;
  /** Commit the worktree was created from — base for the cumulative diff. */
  base: string;
  /** Latest checkpoint commit (= base until the first turn commits). */
  headHash: string;
  /** Stable uuid: `--session-id` on turn 1, `--resume` after; also the cancel key. */
  claudeSessionId: string;
  /** Current model for the next turn ("" = account default). Changeable mid-session. */
  model: string;
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
  session: AgentSession | null;
  /** A create/keep/discard transition is in flight. */
  busy: boolean;
  /** A turn is currently streaming. */
  running: boolean;
  start: (repoPath: string, prompt: string, model: string) => Promise<void>;
  send: (prompt: string) => Promise<void>;
  setModel: (model: string) => void;
  cancel: () => Promise<void>;
  keep: (squash: boolean) => Promise<void>;
  discard: () => Promise<void>;
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

/**
 * Runs the session's LAST (already-appended) turn: streams the agent into it,
 * then commits the turn as a checkpoint. Guards every write on the session still
 * being the same one (the user may have discarded mid-stream).
 */
async function runTurn(
  get: () => SessionsState,
  set: (partial: Partial<SessionsState>) => void,
  prompt: string,
  resume: boolean,
) {
  const s0 = get().session;
  if (!s0) return;
  const sid = s0.claudeSessionId;
  const wtPath = s0.worktreePath;
  const model = s0.model;

  const patchTurn = (p: Partial<SessionTurn>) => {
    const cur = get().session;
    if (!cur || cur.claudeSessionId !== sid || cur.turns.length === 0) return;
    const turns = cur.turns.slice();
    const i = turns.length - 1;
    turns[i] = { ...turns[i], ...p };
    set({ session: { ...cur, turns } });
  };

  set({ running: true });
  try {
    await runAgentSession({
      binPath: null,
      model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: prompt,
      worktreePath: wtPath,
      sessionId: sid,
      resume,
      onEvent: (ev) => {
        const cur = get().session;
        if (!cur || cur.claudeSessionId !== sid) return;
        const last = cur.turns[cur.turns.length - 1];
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
    set({ running: false });
    return;
  }

  // Commit this turn's changes as a checkpoint (unless it errored / was cancelled).
  const cur = get().session;
  if (!cur || cur.claudeSessionId !== sid) {
    set({ running: false });
    return;
  }
  if (cur.turns[cur.turns.length - 1]?.status === "error") {
    set({ running: false });
    return;
  }
  patchTurn({ status: "committing", statusText: "Committing this turn…" });
  try {
    const msg = prompt.split("\n")[0].slice(0, 72).trim() || "Agent turn";
    const hash = await commitWorktreeAll(wtPath, msg);
    const cur2 = get().session;
    if (!cur2 || cur2.claudeSessionId !== sid) {
      set({ running: false });
      return;
    }
    const turns = cur2.turns.slice();
    turns[turns.length - 1] = {
      ...turns[turns.length - 1],
      status: "done",
      statusText: "",
      commitHash: hash,
    };
    set({
      running: false,
      session: { ...cur2, turns, headHash: hash ?? cur2.headHash },
    });
  } catch (e) {
    patchTurn({ status: "error", error: String(e), statusText: "" });
    set({ running: false });
  }
}

/**
 * One write-capable, multi-turn agent session at a time: create a worktree →
 * run turns (each resumes the prior context, commits a checkpoint) → Keep
 * (optionally squashing the per-turn commits) or Discard.
 */
export const useSessionsStore = create<SessionsState>((set, get) => ({
  session: null,
  busy: false,
  running: false,

  start: async (repoPath, prompt, model) => {
    if (get().session || get().busy) return;
    const task = prompt.trim();
    if (!task) return;
    set({ busy: true });
    let wt: Awaited<ReturnType<typeof createWorktree>>;
    try {
      wt = await createWorktree(repoPath);
    } catch (e) {
      toastError(e);
      set({ busy: false });
      return;
    }
    set({
      busy: false,
      session: {
        repoPath,
        worktreePath: wt.path,
        branch: wt.branch,
        base: wt.base,
        headHash: wt.base,
        claudeSessionId: crypto.randomUUID(),
        model,
        turns: [newTurn(task)],
      },
    });
    await runTurn(get, set, task, false);
  },

  send: async (prompt) => {
    const s = get().session;
    if (!s || get().running || get().busy) return;
    const task = prompt.trim();
    if (!task) return;
    set({ session: { ...s, turns: [...s.turns, newTurn(task)] } });
    await runTurn(get, set, task, true);
  },

  setModel: (model) => {
    const s = get().session;
    if (s) set({ session: { ...s, model } });
  },

  cancel: async () => {
    const s = get().session;
    if (!s || !get().running) return;
    try {
      await cancelAgentSession(s.claudeSessionId);
    } catch (e) {
      toastError(e);
    }
    // Keep the session open (the user can send another turn or discard); just
    // mark the in-flight turn cancelled.
    const cur = get().session;
    if (cur && cur.turns.length > 0) {
      const turns = cur.turns.slice();
      const i = turns.length - 1;
      if (turns[i].status === "running" || turns[i].status === "committing")
        turns[i] = {
          ...turns[i],
          status: "error",
          error: "Cancelled.",
          statusText: "",
        };
      set({ running: false, session: { ...cur, turns } });
    } else {
      set({ running: false });
    }
  },

  keep: async (squash) => {
    const s = get().session;
    if (!s || get().running) return;
    set({ busy: true });
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
      set({ session: null });
    } catch (e) {
      toastError(e);
    } finally {
      set({ busy: false });
    }
  },

  discard: async () => {
    const s = get().session;
    if (!s || get().running) return;
    set({ busy: true });
    try {
      await removeWorktree(s.repoPath, s.worktreePath, s.branch, true);
      set({ session: null });
    } catch (e) {
      toastError(e);
    } finally {
      set({ busy: false });
    }
  },
}));
