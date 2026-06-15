import type { GhBranchProtection } from "@/lib/git/types";
import { ALL_MERGE_METHODS, type BranchProtection } from "./types";

/**
 * Maps GitHub's (classic) branch protection rules to GitDesktop protections.
 * GitHub's per-rule `pattern` lines up with our glob pattern, so the import is
 * direct; required linear history forbids merge commits, leaving squash/rebase.
 */
export function githubProtectionsToRules(
  protections: GhBranchProtection[],
): BranchProtection[] {
  return protections.map((p) => ({
    id: crypto.randomUUID(),
    pattern: p.pattern,
    blockDeletion: !p.allowsDeletions,
    blockForcePush: !p.allowsForcePushes,
    requirePr: p.requiresApprovingReviews,
    allowedMergeMethods: p.requiresLinearHistory
      ? ["squash", "rebase"]
      : [...ALL_MERGE_METHODS],
  }));
}
