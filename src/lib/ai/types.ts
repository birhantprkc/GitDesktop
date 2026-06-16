export type AiProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "ollama"
  | "claude-cli";

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

export type ReviewMode = "general" | "security";

export interface ReviewPromptInput {
  title: string;
  body: string;
  commitSubjects: string[];
  diffText: string;
  diffTruncated: boolean;
  files: { path: string; added: number; deleted: number; isBinary: boolean }[];
}
