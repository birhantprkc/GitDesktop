export interface GitInfo {
  version: string;
}

export interface RepoInfo {
  root: string;
  name: string;
}

export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "conflicted"
  | "untracked";

export interface FileEntry {
  path: string;
  origPath?: string;
  staged: ChangeKind | null;
  unstaged: ChangeKind | null;
}

export interface BranchHead {
  name: string | null;
  detached: boolean;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface RepoStatus {
  branch: BranchHead;
  entries: FileEntry[];
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
}

export interface FileDiff {
  filePath: string;
  isBinary: boolean;
  isTruncated: boolean;
  text: string;
}

export interface DiffStatEntry {
  path: string;
  added: number;
  deleted: number;
  isBinary: boolean;
}

export interface StagedDiff {
  text: string;
  truncated: boolean;
  files: DiffStatEntry[];
  /** Changed files hidden from the AI context by ignore patterns. */
  excludedFiles: number;
}

export interface CommitSummary {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface CommitDetails {
  hash: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  date: string;
}

export interface CommitResult {
  hash: string;
}

export interface BranchComparison {
  /** On `compare` but not `base` — what a PR would introduce. */
  ahead: CommitSummary[];
  /** On `base` but not `compare` — what `compare` is missing. */
  behind: CommitSummary[];
}

export interface GhStatus {
  installed: boolean;
  authenticated: boolean;
  /** "owner/name" when this repo has a GitHub remote gh recognizes. */
  repo: string | null;
}

export interface PrRef {
  number: number;
  url: string;
}

export interface PrInfo {
  number: number;
  url: string;
  title: string;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  state: string;
}

export interface PrCommitOut {
  oid: string;
  headline: string;
  date: string;
  author: string;
}

export interface PrFileOut {
  path: string;
  additions: number;
  deletions: number;
}

export interface PrThreadOut {
  author: string;
  /** Review state (APPROVED/COMMENTED/CHANGES_REQUESTED); "" for comments. */
  state: string;
  body: string;
  date: string;
}

export interface PrCheckOut {
  name: string;
  status: string;
}

export interface PrDetails {
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  url: string;
  commits: PrCommitOut[];
  files: PrFileOut[];
  reviews: PrThreadOut[];
  comments: PrThreadOut[];
  checks: PrCheckOut[];
}
