//! The neutral, provider-agnostic data model the `Forge` abstraction speaks in.
//!
//! Today every hosted feature deserializes GitHub's own shapes (`GhStatus`,
//! `PrInfo`, …). To support GitLab and Bitbucket without branching every panel,
//! the backend grows a small set of host-independent types here; each `Forge`
//! impl maps its provider's API onto them. Phase 0 only needs [`ForgeStatus`] +
//! [`Capabilities`]; later phases add `PullRequest`, `Issue`, etc. alongside.

use serde::Serialize;

/// Which hosting platform backs a repo's hosted features.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    GitHub,
    GitLab,
    Bitbucket,
}

/// What a provider (and this repo on it) actually supports, so the UI shows only
/// the controls that work instead of erroring. The platforms are *not*
/// feature-identical — Bitbucket Cloud has no labels/milestones/stars, GitLab has
/// no Discussions — so panels gate on these flags rather than assuming GitHub.
///
/// GitHub is all-true today; GitLab/Bitbucket follow the parity matrix in
/// `docs/multi-provider-support.md` §6. The set grows as later phases migrate more
/// panels behind capability gates (rulesets, collaborators, pages, …).
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub pull_requests: bool,
    pub draft_prs: bool,
    pub issues: bool,
    pub labels: bool,
    pub milestones: bool,
    pub reactions: bool,
    pub discussions: bool,
    pub stars: bool,
    pub ci: bool,
    pub webhooks: bool,
    pub approvals: bool,
}

impl Capabilities {
    /// The static capability profile for a provider (refined per-repo later, e.g.
    /// a Bitbucket repo with issues disabled). Mirrors the §6 parity matrix.
    pub const fn for_provider(provider: Provider) -> Self {
        match provider {
            // GitHub is the reference implementation: everything on.
            Provider::GitHub => Self {
                pull_requests: true,
                draft_prs: true,
                issues: true,
                labels: true,
                milestones: true,
                reactions: true,
                discussions: true,
                stars: true,
                ci: true,
                webhooks: true,
                approvals: true,
            },
            // GitLab: MRs/issues/labels/milestones/CI/approvals, emoji "awards" as
            // reactions, but no Discussions (GitHub-only).
            Provider::GitLab => Self {
                pull_requests: true,
                draft_prs: true,
                issues: true,
                labels: true,
                milestones: true,
                reactions: true,
                discussions: false,
                stars: true,
                ci: true,
                webhooks: true,
                approvals: true,
            },
            // Bitbucket Cloud: no labels, milestones, stars, reactions, draft PRs,
            // or discussions; PRs/CI(pipelines)/webhooks/approvals do work.
            Provider::Bitbucket => Self {
                pull_requests: true,
                draft_prs: false,
                issues: true,
                labels: false,
                milestones: false,
                reactions: false,
                discussions: false,
                stars: false,
                ci: true,
                webhooks: true,
                approvals: true,
            },
        }
    }

    /// Nothing supported — the profile for a repo with no recognized hosted
    /// remote (so every hosted control hides).
    pub const fn none() -> Self {
        Self {
            pull_requests: false,
            draft_prs: false,
            issues: false,
            labels: false,
            milestones: false,
            reactions: false,
            discussions: false,
            stars: false,
            ci: false,
            webhooks: false,
            approvals: false,
        }
    }
}

/// The provider-neutral analogue of `GhStatus`: is the hosted integration usable
/// for this repo, on which host, signed in as whom, and what does it support. The
/// frontend gates hosted features on this instead of a GitHub-only readiness
/// check, so the same panels light up for any provider.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForgeStatus {
    /// The detected provider, or `None` when the repo has no recognized hosted
    /// remote (a purely-local repo, or a host we don't support).
    pub provider: Option<Provider>,
    /// The provider's tooling/credential is available (its CLI is installed, or an
    /// HTTP token is configured).
    pub installed: bool,
    /// Signed in on this repo's host.
    pub authenticated: bool,
    /// `"owner/name"` (or `"group/subgroup/name"` on GitLab) when recognized.
    pub repo: Option<String>,
    /// The repo's host — `"github.com"`, an Enterprise/self-managed server,
    /// `"gitlab.com"`, `"bitbucket.org"` — when known.
    pub host: Option<String>,
    /// The active account's login on this repo's host, when determinable.
    pub login: Option<String>,
    /// What this provider/repo supports — drives capability-gated UI.
    pub capabilities: Capabilities,
}

impl ForgeStatus {
    /// A "recognized, but not yet wired up" status for a provider whose impl
    /// hasn't landed (GitLab/Bitbucket during the phased rollout): the host is
    /// known and capabilities advertised, but the integration reports not-ready.
    pub fn unimplemented(provider: Provider, host: String) -> Self {
        Self {
            provider: Some(provider),
            installed: false,
            authenticated: false,
            repo: None,
            host: Some(host),
            login: None,
            capabilities: Capabilities::for_provider(provider),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_supports_everything() {
        let c = Capabilities::for_provider(Provider::GitHub);
        assert!(c.discussions && c.labels && c.milestones && c.draft_prs && c.reactions && c.stars);
    }

    #[test]
    fn gitlab_has_everything_but_discussions() {
        let c = Capabilities::for_provider(Provider::GitLab);
        assert!(!c.discussions);
        assert!(c.labels && c.milestones && c.stars && c.reactions && c.approvals);
    }

    #[test]
    fn bitbucket_drops_unsupported_features() {
        let c = Capabilities::for_provider(Provider::Bitbucket);
        assert!(!c.labels && !c.milestones && !c.stars && !c.reactions && !c.draft_prs && !c.discussions);
        // …but the core flow still works.
        assert!(c.pull_requests && c.ci && c.webhooks && c.approvals);
    }

    #[test]
    fn none_supports_nothing() {
        let c = Capabilities::none();
        assert!(!c.pull_requests && !c.issues && !c.ci && !c.webhooks);
    }
}
