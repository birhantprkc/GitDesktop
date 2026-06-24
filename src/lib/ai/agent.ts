import { Channel } from "@tauri-apps/api/core";
import { invoke } from "@/lib/tauri/invoke";
import type { AiProviderId } from "./types";

/** Which agent CLI the Rust backend should drive. */
export type AgentKind = "claude" | "codex" | "copilot" | "opencode";

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
  | { kind: "error"; message: string }
  /** The CLI's own resume id captured on turn 1 (Codex thread / opencode session)
   *  — persisted so a host session resumes the right conversation. Only sessions
   *  care; reviews ignore it. */
  | { kind: "nativeSession"; id: string };

/** Maps a review provider id to its backend agent kind, or null if not a CLI. */
export function providerKind(provider: AiProviderId): AgentKind | null {
  if (provider === "claude-cli") return "claude";
  if (provider === "codex-cli") return "codex";
  if (provider === "copilot-cli") return "copilot";
  if (provider === "opencode-cli") return "opencode";
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
  /** Reasoning/effort level ("" = provider default; else low/medium/high/xhigh).
   *  Mapped per-CLI in Rust (Codex/Copilot/opencode flags, Claude thinking keyword). */
  effort: string;
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
    effort: args.effort,
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
  /** Which CLI drives the session. */
  agent: "claude" | "codex" | "copilot" | "opencode";
  /** Explicit Claude binary path, or null to auto-detect. */
  binPath: string | null;
  model: string;
  /** Reasoning/effort level ("" = provider default; else low/medium/high/xhigh).
   *  Mapped per-CLI in Rust (Codex flag, Copilot flag, Claude thinking keyword). */
  effort: string;
  systemPrompt: string;
  /** The task/message for this turn, fed to the CLI on stdin. */
  userPrompt: string;
  /** The directory the agent runs in — a throwaway worktree for a write session,
   *  or the live repo for a read-only Plan conversation. */
  worktreePath: string;
  /** The session's stable uuid (sets `--session-id` on turn 1, `--resume` after);
   *  also the cancel key for `cancelAgentSession`. */
  sessionId: string;
  /** false = first turn (start the session), true = a follow-up turn (resume it). */
  resume: boolean;
  /** Read-only mode (a Plan conversation): swaps each CLI's write toolset for its
   *  read-only one, so the resumable turn can explore but never write. */
  readOnly: boolean;
  /** Isolation mode, fixed at session creation. "container" runs the turn inside
   *  a Docker/Podman container; anything else runs on the host (worktree-confined
   *  by each CLI's own OS sandbox). */
  isolation: string;
  /** The CLI's native resume id from turn 1 (the `nativeSession` event), passed
   *  back on resume so a host session continues the right conversation (Codex
   *  thread / opencode session); null otherwise. */
  nativeSessionId: string | null;
  onEvent: (event: ReviewEvent) => void;
}

/**
 * Runs one turn of a write-capable agent session: the CLI implements
 * `userPrompt` full-auto inside the worktree, streaming the same events as a
 * review. Follow-up turns (`resume: true`) keep the full conversation + worktree
 * state. On the host each CLI is worktree-confined — Codex via its own OS sandbox
 * (`-s workspace-write`), the others "soft" (Claude `bypassPermissions`, Copilot
 * `--add-dir`, opencode `--dangerously-skip-permissions`); Claude and Codex can
 * also run in a container (kernel boundary).
 */
export async function runAgentSession(args: AgentSessionArgs): Promise<void> {
  const channel = new Channel<ReviewEvent>();
  channel.onmessage = args.onEvent;
  await invoke<void>("agent_session", {
    agent: args.agent,
    binPath: args.binPath,
    model: args.model,
    effort: args.effort,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    worktreePath: args.worktreePath,
    sessionId: args.sessionId,
    resume: args.resume,
    readOnly: args.readOnly,
    isolation: args.isolation,
    nativeSessionId: args.nativeSessionId,
    onEvent: channel,
  });
}

/** Signals an in-flight session to stop (shares the backend cancel registry). */
export const cancelAgentSession = (sessionId: string) =>
  invoke<void>("agent_review_cancel", { reviewId: sessionId });
