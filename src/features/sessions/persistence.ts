import { invoke } from "@/lib/tauri/invoke";
import type { AgentSession } from "./store";

// Sessions persist as append-only JSON-Lines transcripts, one file per session
// (`<app_data>/sessions/<id>.jsonl`), written by the Rust `sessions` module — so
// a long, resumable conversation never re-serializes its whole history the way
// the previous single growing blob did. The store appends one event per
// lifecycle transition (create / turn start / turn result / model / kept) and
// folds the log back into sessions on startup. Diffs aren't stored — a turn
// carries its checkpoint commit and the diff is reconstructed from git.

/** Load + fold all persisted sessions (in creation order, `running:false`,
 *  interrupted turns already marked). Migrates the legacy single-file store on
 *  first run. */
export const loadPersistedSessions = () =>
  invoke<AgentSession[]>("transcript_load_all");

/** Write a new session's header line (once, at creation). */
export const createTranscript = (session: {
  id: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  base: string;
  claudeSessionId: string;
  model: string;
  isolation: string;
  agent: string;
}) => invoke<void>("transcript_create", { session });

/** Record the start of a turn (`seq` = its index in the session). */
export const appendTurn = (
  id: string,
  seq: number,
  prompt: string,
  model: string,
) => invoke<void>("transcript_append_turn", { id, seq, prompt, model });

/** Record a turn's terminal result. `status` is "done" or "error". */
export const appendResult = (
  id: string,
  seq: number,
  status: string,
  narration: string,
  commitHash: string | null,
  costUsd: number | null,
  error: string | null,
) =>
  invoke<void>("transcript_append_result", {
    id,
    seq,
    status,
    narration,
    commitHash,
    costUsd,
    error,
  });

/** Record a mid-session model change (folded last-wins). */
export const appendModel = (id: string, model: string) =>
  invoke<void>("transcript_append_meta", { id, model });

/** Record Codex's thread id (captured from turn 1), so a host session resumes the
 *  right thread after a reload. Folded last-wins, same `meta` event as the model. */
export const appendCodexThread = (id: string, codexThreadId: string) =>
  invoke<void>("transcript_append_meta", { id, codexThreadId });

/** Record a Keep (`kept=true`) or Resume (`kept=false`). */
export const setKept = (id: string, kept: boolean) =>
  invoke<void>("transcript_set_kept", { id, kept });

/** Delete a session's transcript (on discard / record removal). */
export const removeTranscript = (id: string) =>
  invoke<void>("transcript_remove", { id });
