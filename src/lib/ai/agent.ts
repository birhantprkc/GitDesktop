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
  | { kind: "done"; text: string; isError: boolean; costUsd: number | null }
  | { kind: "error"; message: string };

/** Maps a review provider id to its backend agent kind, or null if not a CLI. */
export function providerKind(provider: AiProviderId): AgentKind | null {
  return provider === "claude-cli" ? "claude" : null;
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
    reviewId: args.reviewId,
    onEvent: channel,
  });
}

/** Signals an in-flight review to stop (kills the subprocess). */
export const cancelAgentReview = (reviewId: string) =>
  invoke<void>("agent_review_cancel", { reviewId });
