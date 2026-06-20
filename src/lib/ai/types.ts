export type AiProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "ollama"
  | "ollama-cloud"
  | "claude-cli"
  | "codex-cli";

export interface AiSettings {
  provider: AiProviderId;
  model: string;
  ollamaBaseUrl: string;
  /** Explicit path to the agent CLI binary (CLI providers only); empty/omitted
   *  means auto-detect on PATH and the known install locations. */
  cliPath?: string;
  /** CLI providers: let the agent read surrounding repo files for context
   *  (Tier 2), instead of reviewing the diff alone. Slower and pricier. */
  cliRepoAware?: boolean;
}

export interface AiStreamRequest {
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}

export interface AiClient {
  /** Streams raw text chunks from the model. */
  stream: (req: AiStreamRequest) => AsyncIterable<string>;
  /** Cheap round-trip used by the Settings "Test connection" button. */
  testConnection: () => Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface CommitPromptInput {
  diffText: string;
  diffTruncated: boolean;
  files: { path: string; added: number; deleted: number; isBinary: boolean }[];
  /** Changed files hidden from this context by the user's ignore patterns. */
  excludedFiles: number;
  recentSubjects: string[];
  repoInstructions: string | null;
  globalInstructions: string;
}

export interface PrPromptInput {
  diffText: string;
  diffTruncated: boolean;
  files: { path: string; added: number; deleted: number; isBinary: boolean }[];
  /** Subjects of the commits this PR would introduce (base..head). */
  commitSubjects: string[];
  baseBranch: string;
  headBranch: string;
  repoInstructions: string | null;
  globalInstructions: string;
}

export interface BranchNamePromptInput {
  diffText: string;
  diffTruncated: boolean;
  files: { path: string; added: number; deleted: number; isBinary: boolean }[];
  /** Untracked (new) file paths — no diff content, but the names guide naming. */
  untrackedPaths: string[];
  /** Changed files hidden from this context by the user's ignore patterns. */
  excludedFiles: number;
  /** Existing branch names, as a naming-convention / style reference. */
  recentBranches: string[];
  repoInstructions: string | null;
  globalInstructions: string;
}

export type ReviewMode = "general" | "security";

/** How the "changes since last review" delta relates to the prior review.
 *  `head-unchanged` is JS-only (the Rust command never returns it); the Rust
 *  `missing` reason is mapped to `indeterminate` before it reaches the prompt. */
export type ReviewDeltaState =
  | "ok"
  | "rewritten"
  | "indeterminate"
  | "head-unchanged";

export interface ReviewPromptInput {
  title: string;
  body: string;
  commitSubjects: string[];
  diffText: string;
  diffTruncated: boolean;
  files: { path: string; added: number; deleted: number; isBinary: boolean }[];
  /** Prior review's raw finding markdown — soft, re-verifiable context. When
   *  absent, the prompt is byte-for-byte identical to a first-ever review. */
  priorFindings?: string;
  /** When the prior review ran (epoch ms) — for the section header. */
  priorReviewedAt?: number;
  /** Two-dot delta of what changed since the prior review (when computable). */
  deltaDiffText?: string;
  /** Whether `deltaDiffText` was already truncated upstream (Rust max_bytes). */
  deltaTruncated?: boolean;
  /** Why the delta is present or absent — frames the "Changes since" section. */
  deltaState?: ReviewDeltaState;
}
