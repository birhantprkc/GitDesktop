/**
 * Branch rules are GitDesktop-local governance, stored per repository in app
 * data (never written into the repo). They're modeled on GitHub's branch
 * protection / rulesets but enforced at GitDesktop's own action points — so
 * they prevent accidents on ANY repo, even ones not hosted on GitHub. (Phase 3
 * will let GitHub repos import/sync their real server-side rulesets on top.)
 */

/** Allowed ways to integrate a head branch into a protected base. */
export type MergeMethod = "merge" | "squash" | "rebase";

/** A protection that applies to every branch whose name matches `pattern`. */
export interface BranchProtection {
  id: string;
  /** fnmatch-style glob, e.g. "main", "release/*", "{main,develop}". */
  pattern: string;
  /** Block deleting matching branches from GitDesktop. */
  blockDeletion: boolean;
}

/** Repo-wide policy for the names of NEW branches. */
export interface NamingPolicy {
  /** When on, new branch names must match `pattern`. */
  enabled: boolean;
  /** fnmatch-style glob a new branch name must match. */
  pattern: string;
  /** Friendly examples shown when a name is rejected, e.g. "feature/*, fix/*". */
  hint: string;
}

export interface BranchRulesConfig {
  naming: NamingPolicy;
  protections: BranchProtection[];
}

export const EMPTY_BRANCH_RULES: BranchRulesConfig = {
  naming: { enabled: false, pattern: "", hint: "" },
  protections: [],
};
