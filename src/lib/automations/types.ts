import type { ReviewMode } from "@/lib/ai/types";

export type AutomationTrigger = "commit" | "pr-open";

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
  /** Keyed by repo path. */
  repos: Record<string, RepoAutomations>;
}

export const EMPTY_AUTOMATIONS: AutomationsConfig = { global: [], repos: {} };

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  commit: "On commit",
  "pr-open": "On pull request opened",
};

export const ACTION_LABELS: Record<ReviewMode, string> = {
  general: "AI code review",
  security: "AI security audit",
};

/**
 * The rules that actually run for a repo and trigger: enabled global rules
 * not switched off for the repo, plus the repo's own enabled rules.
 */
export function effectiveRules(
  config: AutomationsConfig,
  repoPath: string,
  trigger: AutomationTrigger,
): AutomationRule[] {
  const repo = config.repos[repoPath];
  const disabled = new Set(repo?.disabledGlobalIds ?? []);
  return [
    ...config.global.filter((r) => r.enabled && !disabled.has(r.id)),
    ...(repo?.rules ?? []).filter((r) => r.enabled),
  ].filter((r) => r.trigger === trigger);
}
