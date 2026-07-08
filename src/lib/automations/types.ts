import type { ReviewMode } from "@/lib/ai/types";

export type AutomationTrigger = "commit" | "pr-open" | "pr-sync";

export interface AutomationRule {
  id: string;
  trigger: AutomationTrigger;
  /** What to run — the same modes as the manual Review tab. */
  action: ReviewMode;
  enabled: boolean;
}

/** A repo's adjustments on top of the global rules. */
export interface RepoAutomations {
  /** Global rule ids switched off for this repo. */
  disabledGlobalIds: string[];
  /** Rules that exist only for this repo. */
  rules: AutomationRule[];
}

export interface AutomationsConfig {
  global: AutomationRule[];
  /** Keyed by the repo's worktree-stable identity (its common git dir), so a
   *  repo's overrides apply the same from the main checkout and every worktree.
   *  Older entries may still be keyed by a checkout path until the next save
   *  folds them onto the identity (see `repoEntry` / `repoAutomationsFor`). */
  repos: Record<string, RepoAutomations>;
}

export const EMPTY_AUTOMATIONS: AutomationsConfig = { global: [], repos: {} };

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  commit: "On commit",
  "pr-open": "On pull request opened",
  "pr-sync": "On new commits to a reviewed PR",
};

export const ACTION_LABELS: Record<ReviewMode, string> = {
  general: "AI code review",
  security: "AI security audit",
};

/**
 * A repo's per-repo overrides, looked up by its worktree-stable identity with a
 * legacy checkout-path fallback (until the next save folds the old key onto the
 * identity). Pure, so it's shared by the sync React consumers and the async store
 * helper — the caller resolves `identity` via `repoIdentity`/`useRepoIdentity`.
 */
export function repoEntry(
  config: AutomationsConfig,
  identity: string,
  repoPath: string,
): RepoAutomations | undefined {
  return (
    config.repos[identity] ??
    (identity === repoPath ? undefined : config.repos[repoPath])
  );
}

/**
 * The rules that actually run for a repo and trigger: enabled global rules
 * not switched off for the repo, plus the repo's own enabled rules. Takes the
 * already-resolved per-repo entry (see `repoEntry`) so it stays a pure sync
 * function on the hot path — the caller owns identity resolution.
 */
export function effectiveRules(
  config: AutomationsConfig,
  repo: RepoAutomations | undefined,
  trigger: AutomationTrigger,
): AutomationRule[] {
  const disabled = new Set(repo?.disabledGlobalIds ?? []);
  return [
    ...config.global.filter((r) => r.enabled && !disabled.has(r.id)),
    ...(repo?.rules ?? []).filter((r) => r.enabled),
  ].filter((r) => r.trigger === trigger);
}
