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

/** Why a `DeltaDiff` could (or couldn't) be computed — drives how the caller
 *  frames or omits the "changes since last review" delta. */
export type DeltaReason = "ok" | "missing" | "rewritten" | "indeterminate";

/** The literal two-dot `from..to` diff ("what changed since"), with a `reason`
 *  for graceful fallback when the delta can't be produced. */
export interface DeltaDiff {
  resolvable: boolean;
  isAncestor: boolean;
  reason: DeltaReason;
  text: string;
  truncated: boolean;
  files: DiffStatEntry[];
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

// ── Insights graphs (local-git) ──────────────────────────────────────────────

/** A contributor with commit count + line churn, for the Insights tab. */
export interface ContributorChurn {
  name: string;
  commits: number;
  additions: number;
  deletions: number;
}

/** Commits in one ISO week ("2025-07"); sorts chronologically as a string. */
export interface WeekCount {
  week: string;
  commits: number;
}

/** Additions/deletions in one ISO week, for the code-frequency graph. */
export interface CodeFreqPoint {
  week: string;
  additions: number;
  deletions: number;
}

/** Punch card: 7 rows (day-of-week, 0=Sun) × 24 columns (hour) of commit counts. */
export type PunchCard = number[][];

/** Community-health profile + social counts (gh API), for the Insights tab. */
export interface CommunityInsights {
  healthPercentage: number;
  hasReadme: boolean;
  hasLicense: boolean;
  hasCodeOfConduct: boolean;
  hasContributing: boolean;
  hasIssueTemplate: boolean;
  hasPullRequestTemplate: boolean;
  license: string | null;
  forksCount: number;
  stargazersCount: number;
  watchersCount: number;
  openIssuesCount: number;
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
  /** Head commit SHA — drives pr-sync detection for remote PRs. */
  headSha: string;
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

export interface Milestone {
  number: number;
  title: string;
}

/** An org-defined issue type (Bug/Feature/Task/…). */
export interface IssueType {
  id: string;
  name: string;
  /** GitHub color NAME (GRAY/BLUE/GREEN/YELLOW/ORANGE/RED/PINK/PURPLE). */
  color: string;
}

export interface Reaction {
  /** GitHub ReactionContent enum value (THUMBS_UP, HEART, ROCKET, …). */
  content: string;
  count: number;
  /** Whether the signed-in user has this reaction (drives the toggle). */
  viewerReacted: boolean;
}

export interface IssueReactions {
  body: Reaction[];
  /** Reactions per comment, keyed by the comment's GraphQL node id. */
  comments: Record<string, Reaction[]>;
}

export interface DiscussionCategory {
  id: string;
  name: string;
  /** The category glyph (e.g. "🏎️"); may be empty. */
  emoji: string;
  isAnswerable: boolean;
}

export interface DiscussionMeta {
  /** GraphQL node id of the repository — needed to create a discussion. */
  repoId: string;
  hasDiscussionsEnabled: boolean;
  categories: DiscussionCategory[];
}

export interface DiscussionInfo {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  isAnswered: boolean;
  closed: boolean;
  stateReason: string | null;
  categoryName: string;
  categoryEmoji: string;
  author: string;
  commentCount: number;
  upvoteCount: number;
  labels: RepoLabel[];
}

export interface DiscussionReply {
  id: string;
  author: string;
  body: string;
  date: string;
  url: string;
  viewerDidAuthor: boolean;
  isMinimized: boolean;
  minimizedReason: string;
}

export interface DiscussionComment {
  id: string;
  author: string;
  body: string;
  date: string;
  url: string;
  viewerDidAuthor: boolean;
  isMinimized: boolean;
  minimizedReason: string;
  upvoteCount: number;
  viewerHasUpvoted: boolean;
  /** Whether this comment is the discussion's accepted answer. */
  isAnswer: boolean;
  replies: DiscussionReply[];
}

export interface DiscussionDetails {
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  createdAt: string;
  categoryName: string;
  categoryEmoji: string;
  /** Whether the category accepts answers (Q&A) — gates "Mark as answer". */
  isAnswerable: boolean;
  isAnswered: boolean;
  upvoteCount: number;
  viewerHasUpvoted: boolean;
  locked: boolean;
  /** GitHub's lock reason (OFF_TOPIC/TOO_HEATED/RESOLVED/SPAM) or null. */
  activeLockReason: string | null;
  closed: boolean;
  /** Close reason (RESOLVED/OUTDATED/DUPLICATE) or null. */
  stateReason: string | null;
  labels: RepoLabel[];
  comments: DiscussionComment[];
}

/** One issue in a parent/sub-issue relationship. */
export interface RelatedIssue {
  /** GraphQL node id (used to remove the relationship). */
  id: string;
  number: number;
  title: string;
  /** "OPEN" or "CLOSED". */
  state: string;
  url: string;
}

/** An issue's parent and sub-issues, with the completion summary. */
export interface IssueRelations {
  parent: RelatedIssue | null;
  subIssues: RelatedIssue[];
  completed: number;
  total: number;
}

/** An issue's dependencies: issues blocking it, and issues it blocks. */
export interface IssueDependencies {
  blockedBy: RelatedIssue[];
  blocking: RelatedIssue[];
}

/** Which dependency direction to edit. */
export type IssueRelation = "blocked_by" | "blocking";

/** A pull request linked to an issue (it closes / references it). */
export interface LinkedPr {
  number: number;
  title: string;
  /** "OPEN", "CLOSED", or "MERGED". */
  state: string;
  url: string;
}

/** An issue's "Development" links: closing PRs + linked branches. */
export interface IssueDevelopment {
  prs: LinkedPr[];
  branches: string[];
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
  milestone: Milestone | null;
  issueType: IssueType | null;
  isPinned: boolean;
  locked: boolean;
  /** GitHub's lock reason (off_topic/resolved/spam/too_heated) or null. */
  activeLockReason: string | null;
  /** Conversation comments (shared shape with PRs). */
  comments: PrThreadOut[];
  labels: RepoLabel[];
}

/** One git tag, for the Tags list. */
export interface TagInfo {
  name: string;
  /** The commit the tag points to (dereferenced for annotated tags). */
  target: string;
  date: string;
  annotated: boolean;
  /** Tag annotation subject (annotated) or the commit subject (lightweight). */
  subject: string;
}

/** A GitHub release in the list view (merged with tags by tagName). */
export interface ReleaseInfo {
  tagName: string;
  name: string;
  isDraft: boolean;
  isPrerelease: boolean;
  isLatest: boolean;
  publishedAt: string;
}

export interface ReleaseAsset {
  name: string;
  size: number;
  downloadCount: number;
  url: string;
}

export interface ReleaseDetails {
  tagName: string;
  name: string;
  body: string;
  author: string;
  publishedAt: string;
  isDraft: boolean;
  isPrerelease: boolean;
  targetCommitish: string;
  url: string;
  assets: ReleaseAsset[];
}

/** GitHub's auto-generated release notes (suggested title + body). */
export interface GeneratedNotes {
  name: string;
  body: string;
}

/** An ignored file and the .gitignore rule responsible for ignoring it. A
 *  trailing "/" on `path` marks a collapsed fully-ignored directory. */
export interface IgnoredFile {
  path: string;
  source: string;
  line: number;
  pattern: string;
}

/** A gitignore rule to delete: the file it lives in + its exact pattern line. */
export interface UnignoreRule {
  source: string;
  pattern: string;
}
