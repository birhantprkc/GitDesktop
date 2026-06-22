import { Channel } from "@tauri-apps/api/core";
import { invoke } from "@/lib/tauri/invoke";
import type { AiProviderId } from "./types";

/** Which agent CLI the Rust backend should drive. */
export type AgentKind = "claude" | "codex";

export type AuthStatus = "authed" | "notAuthed" | "unknown";

export interface AgentInfo {
  found: boolean;
  path: string | null;
  version: string | null;
  authed: AuthStatus;
}

/** Streaming events from `agent_review`, mirroring the Rust `ReviewEvent`. */
export type ReviewEvent =
  | { kind: "delta"; text: string }
  | { kind: "status"; text: string }
  | { kind: "done"; text: string; isError: boolean; costUsd: number | null }
  | { kind: "error"; message: string };

/** Maps a review provider id to its backend agent kind, or null if not a CLI. */
export function providerKind(provider: AiProviderId): AgentKind | null {
  if (provider === "claude-cli") return "claude";
  if (provider === "codex-cli") return "codex";
  return null;
}

/** Resolves the CLI binary and reports version + login status for Settings. */
export const detectAgentCli = (kind: AgentKind, path?: string) =>
  invoke<AgentInfo>("agent_detect", {
    kind,
    binPath: path?.trim() || null,
  });

export interface AgentReviewArgs {
  kind: AgentKind;
  /** Explicit binary path, or null to auto-detect. */
  binPath: string | null;
  model: string;
  systemPrompt: string;
  /** The diff-bearing prompt, fed to the CLI on stdin. */
  userPrompt: string;
  repoPath: string;
  /** Tier 2: allow the agent read-only access to the repo for context. */
  repoAware: boolean;
  /** Caller-generated id used to cancel this run via `cancelAgentReview`. */
  reviewId: string;
  onEvent: (event: ReviewEvent) => void;
}

/**
 * Runs a streaming review through the agent CLI. Resolves when the backend
 * command returns (terminal `done`/`error` events arrive via `onEvent`).
 */
export async function runAgentReview(args: AgentReviewArgs): Promise<void> {
  const channel = new Channel<ReviewEvent>();
  channel.onmessage = args.onEvent;
  await invoke<void>("agent_review", {
    kind: args.kind,
    binPath: args.binPath,
    model: args.model,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    repoPath: args.repoPath,
    repoAware: args.repoAware,
    reviewId: args.reviewId,
    onEvent: channel,
  });
}

/** Signals an in-flight review to stop (kills the subprocess). */
export const cancelAgentReview = (reviewId: string) =>
  invoke<void>("agent_review_cancel", { reviewId });

export interface AgentSessionArgs {
  /** Which CLI drives the session. "codex" is container-only. */
  agent: "claude" | "codex";
  /** Explicit Claude binary path, or null to auto-detect. */
  binPath: string | null;
  model: string;
  systemPrompt: string;
  /** The task/message for this turn, fed to the CLI on stdin. */
  userPrompt: string;
  /** The throwaway worktree the agent runs (and writes) inside. */
  worktreePath: string;
  /** The session's stable uuid (sets `--session-id` on turn 1, `--resume` after);
   *  also the cancel key for `cancelAgentSession`. */
  sessionId: string;
  /** false = first turn (start the session), true = a follow-up turn (resume it). */
  resume: boolean;
  /** Isolation mode, fixed at session creation. "container" runs the turn inside
   *  a Docker/Podman container; anything else runs on the host (worktree-only). */
  isolation: string;
  onEvent: (event: ReviewEvent) => void;
}

/**
 * Runs one turn of a write-capable agent session: the CLI implements
 * `userPrompt` full-auto inside the worktree, streaming the same events as a
 * review. Follow-up turns (`resume: true`) keep the full conversation + worktree
 * state. Claude runs on the host or in a container; Codex is **container-only**
 * (its host workspace-write is trust-gated; full-bypass is safe in the box).
 */
export async function runAgentSession(args: AgentSessionArgs): Promise<void> {
  const channel = new Channel<ReviewEvent>();
  channel.onmessage = args.onEvent;
  await invoke<void>("agent_session", {
    agent: args.agent,
    binPath: args.binPath,
    model: args.model,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    worktreePath: args.worktreePath,
    sessionId: args.sessionId,
    resume: args.resume,
    isolation: args.isolation,
    onEvent: channel,
  });
}

/** Signals an in-flight session to stop (shares the backend cancel registry). */
export const cancelAgentSession = (sessionId: string) =>
  invoke<void>("agent_review_cancel", { reviewId: sessionId });
