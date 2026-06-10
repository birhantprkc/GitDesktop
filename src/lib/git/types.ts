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

export interface CommitResult {
  hash: string;
}
