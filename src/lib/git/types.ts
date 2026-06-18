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
  /** ISO-8601 committer date of the branch tip (for recency sorting). */
  lastCommitDate: string;
  /** Hidden from the branch dropdown (a personal, local-config flag). */
  archived: boolean;
}

/** A local branch's ahead/behind counts vs. the default branch. */
export interface BranchDivergence {
  name: string;
  /** Commits on this branch the default branch doesn't have. */
  ahead: number;
  /** Commits on the default branch this branch doesn't have. */
  behind: number;
}

export interface RepoOwner {
  path: string;
  owner: string | null;
}

/** A git submodule and its state vs. the commit the parent records. */
export interface Submodule {
  path: string;
  sha: string;
  describe: string;
  /** "ok" | "uninitialized" | "modified" | "conflict" */
  status: string;
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
  /** Tags pointing at this commit. */
  tags: string[];
  /** More than one parent — history rewriting must not cross it. */
  isMerge: boolean;
}

export interface CommitDetails {
  hash: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  date: string;
}

/** One line of `git blame`: its content plus the commit that last changed it. */
export interface BlameLine {
  lineNo: number;
  hash: string;
  author: string;
  /** Author time, epoch seconds. */
  time: number;
  summary: string;
  content: string;
}

export interface CommitResult {
  hash: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
}

/** One resulting commit in a history rewrite (multi-hash = squash). */
export interface RewriteStep {
  hashes: string[];
  message?: string;
}

export interface StashEntry {
  index: number;
  message: string;
  date: string;
}

export interface StashFile {
  path: string;
  added: number;
  deleted: number;
  isBinary: boolean;
  /** In the stash's untracked-files parent; its content reads from there. */
  untracked: boolean;
}

export interface LanguageStat {
  name: string;
  files: number;
  lines: number;
  bytes: number;
}

export interface ContributorStat {
  name: string;
  commits: number;
}

export interface RepoStats {
  commitCount: number;
  branchCount: number;
  tagCount: number;
  contributorCount: number;
  topContributors: ContributorStat[];
  firstCommitDate: string | null;
  lastCommitDate: string | null;
  trackedFiles: number;
  trackedBytes: number;
  gitDirBytes: number;
  totalLines: number;
  languages: LanguageStat[];
}

export interface BranchStats {
  commitCount: number;
  contributorCount: number;
  topContributors: ContributorStat[];
  firstCommitDate: string | null;
  lastCommitDate: string | null;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface RepoOpState {
  merging: boolean;
  rebasing: boolean;
  cherryPicking: boolean;
}

export type RepoOp = "merge" | "rebase" | "cherry-pick";

export interface BranchComparison {
  /** On `compare` but not `base` — what a PR would introduce. */
  ahead: CommitSummary[];
  /** On `base` but not `compare` — what `compare` is missing. */
  behind: CommitSummary[];
}

export interface PrPollInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: string;
  reviewDecision: string;
  /** Check rollup of the head commit: SUCCESS/FAILURE/PENDING/"". */
  checksState: string;
}

export interface GhRepo {
  nameWithOwner: string;
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  cloneUrl: string;
  sshUrl: string;
  description: string | null;
  pushedAt: string | null;
}

export interface GhRepoList {
  /** The signed-in user's login, so the UI can list their repos first. */
  viewer: string;
  repos: GhRepo[];
}

export interface GhAccount {
  login: string;
  active: boolean;
}

export interface GhAccounts {
  /** gh's version (e.g. "2.18.1"), "" when gh isn't installed. */
  version: string;
  accounts: GhAccount[];
}

export interface GhStatus {
  installed: boolean;
  authenticated: boolean;
  /** The active account's login, when it can be determined. */
  login: string | null;
  /** "owner/name" when this repo has a GitHub remote gh recognizes. */
  repo: string | null;
}

export interface WebhookConfig {
  url: string;
  /** "json" or "form". */
  contentType: string;
  /** "0" (verify SSL) or "1" (skip verification). */
  insecureSsl: string;
  /** Masked ("********") when a secret is set; absent otherwise. */
  secret: string | null;
}

export interface WebhookLastResponse {
  code: number | null;
  status: string;
  message: string | null;
}

export interface Webhook {
  id: number;
  active: boolean;
  events: string[];
  config: WebhookConfig;
  updatedAt: string;
  lastResponse: WebhookLastResponse;
}

/** New/edited webhook values sent to the backend (camelCase). */
export interface WebhookInput {
  url: string;
  contentType: "json" | "form";
  /** A new secret; null/empty leaves an existing one unchanged. */
  secret: string | null;
  insecureSsl: boolean;
  events: string[];
  active: boolean;
}

/** A past webhook delivery (summary). */
export interface HookDelivery {
  /** A 19-digit snowflake — string, since it exceeds JS's safe integer range. */
  id: string;
  deliveredAt: string;
  redelivery: boolean;
  duration: number;
  status: string;
  statusCode: number;
  event: string;
  action: string | null;
}

/** One delivery's request payload + response body. */
export interface HookDeliveryDetail {
  requestPayload: string;
  responsePayload: string;
}

/** Curated subset of a repo's GitHub settings (read). */
export interface RepoSettings {
  description: string | null;
  homepage: string | null;
  topics: string[];
  defaultBranch: string;
  hasIssues: boolean;
  hasProjects: boolean;
  hasWiki: boolean;
  hasDiscussions: boolean;
  allowSquashMerge: boolean;
  allowMergeCommit: boolean;
  allowRebaseMerge: boolean;
  allowUpdateBranch: boolean;
  deleteBranchOnMerge: boolean;
  allowAutoMerge: boolean;
  webCommitSignoffRequired: boolean;
}

/** Edited settings sent to the backend. */
export interface RepoSettingsInput {
  description: string;
  homepage: string;
  topics: string[];
  defaultBranch: string;
  hasIssues: boolean;
  hasProjects: boolean;
  hasWiki: boolean;
  hasDiscussions: boolean;
  allowSquashMerge: boolean;
  allowMergeCommit: boolean;
  allowRebaseMerge: boolean;
  allowUpdateBranch: boolean;
  deleteBranchOnMerge: boolean;
  allowAutoMerge: boolean;
  webCommitSignoffRequired: boolean;
}

/** A GitHub (classic) branch protection rule, for importing into branch rules. */
export interface GhBranchProtection {
  /** fnmatch-style branch name pattern the rule targets. */
  pattern: string;
  allowsDeletions: boolean;
  allowsForcePushes: boolean;
  requiresLinearHistory: boolean;
  requiresApprovingReviews: boolean;
}

/** State of one git hook in the repo's hooks directory. */
export interface HookEntry {
  name: string;
  description: string;
  /** "active" (installed + runs) | "disabled" (kept, renamed off) | "inactive". */
  state: "active" | "disabled" | "inactive";
  /** Whether git's stock `<name>.sample` is present. */
  hasSample: boolean;
}

export interface HooksInfo {
  /** Absolute path to the effective hooks directory. */
  hooksPath: string;
  /** True when `core.hooksPath` redirects hooks away from `.git/hooks`. */
  customHooksPath: boolean;
  /** A detected hook manager ("husky" | "pre-commit" | "lefthook"). */
  manager: string | null;
  /** Path to the manager's config file/dir, for an "Open config" affordance. */
  managerConfig: string | null;
  entries: HookEntry[];
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
  author: { login: string } | null;
  labels: { name: string }[];
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
  /** GraphQL node id — set for conversation comments, "" for reviews. */
  id: string;
  /** Permalink on GitHub ("" for reviews/local) — for "Copy link". */
  url: string;
  /** Whether the signed-in user wrote it (only their own comments are editable). */
  viewerDidAuthor: boolean;
  /** Whether the comment is hidden (minimized), and GitHub's recorded reason. */
  isMinimized: boolean;
  minimizedReason: string;
}

export interface PrCheckOut {
  name: string;
  status: string;
}

export interface RepoLabel {
  /** GraphQL node id; empty on labels embedded in PR details. */
  id: string;
  name: string;
  /** Hex without the leading '#', as GitHub returns it. */
  color: string;
}

export interface PrDetails {
  /** GraphQL node id, used by the label mutations. */
  id: string;
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
  labels: RepoLabel[];
}

export interface IssueInfo {
  number: number;
  url: string;
  title: string;
  /** "OPEN" or "CLOSED". */
  state: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  labels: { name: string }[];
}

export interface IssueDetails {
  /** GraphQL node id, used by the label mutations. */
  id: string;
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  createdAt: string;
  url: string;
  assignees: string[];
  /** Conversation comments (shared shape with PRs). */
  comments: PrThreadOut[];
  labels: RepoLabel[];
}
