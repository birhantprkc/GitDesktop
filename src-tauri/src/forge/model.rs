//! The neutral, provider-agnostic data model the `Forge` abstraction speaks in.
//!
//! Today every hosted feature deserializes GitHub's own shapes (`GhStatus`,
//! `PrInfo`, …). To support GitLab and Bitbucket without branching every panel,
//! the backend grows a small set of host-independent types here; each `Forge`
//! impl maps its provider's API onto them. Phase 0 only needs [`ForgeStatus`] +
//! [`Capabilities`]; later phases add `PullRequest`, `Issue`, etc. alongside.

use serde::{Deserialize, Serialize};

/// Which hosting platform backs a repo's hosted features.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
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

/// Which hosted features GitDesktop has actually **built** for a provider — a
/// different axis from [`Capabilities`]. Capabilities = what the *platform* can do
/// (GitLab has labels); `Implemented` = what *we've wired up* for it (we may not
/// have built GitLab labels yet). A panel lights up only when the repo is ready
/// **and** the platform supports the feature **and** we've implemented it here.
///
/// GitHub is the reference implementation (everything built). GitLab/Bitbucket
/// flip these on per phase as each read/write path lands — so a *ready* GitLab
/// repo degrades its unbuilt panels to "coming soon" instead of firing `gh_*`
/// calls that would break against it. The frontend mirrors this as
/// `forgeFeatureReady(status, feature)`.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Implemented {
    pub pull_requests: bool,
    pub issues: bool,
    pub ci: bool,
    pub releases: bool,
    pub insights: bool,
    /// Repo-management surface: View/Fork/Star/admin settings, branch-rule import.
    pub repo_actions: bool,
    /// Publishing a local repo to the provider (create remote + push).
    pub publish: bool,
}

impl Implemented {
    /// Everything built — the GitHub reference profile.
    const fn all() -> Self {
        Self {
            pull_requests: true,
            issues: true,
            ci: true,
            releases: true,
            insights: true,
            repo_actions: true,
            publish: true,
        }
    }

    /// Nothing built yet — a recognized provider whose panels aren't wired up.
    pub const fn none() -> Self {
        Self {
            pull_requests: false,
            issues: false,
            ci: false,
            releases: false,
            insights: false,
            repo_actions: false,
            publish: false,
        }
    }

    /// What's built for a provider today. The single place to flip a GitLab /
    /// Bitbucket feature on as its impl lands — bump the flag here and the matching
    /// panel stops degrading to "coming soon".
    pub const fn for_provider(provider: Provider) -> Self {
        match provider {
            Provider::GitHub => Self::all(),
            // GitLab read ops arrive incrementally — merge requests, issues, CI
            // pipelines, and releases (read) are wired up; insights / repo actions
            // still degrade to "coming soon" until their impls land.
            Provider::GitLab => Self {
                pull_requests: true,
                issues: true,
                ci: true,
                releases: true,
                insights: false,
                repo_actions: false,
                publish: false,
            },
            Provider::Bitbucket => Self::none(),
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
    /// Which of those capabilities GitDesktop has actually built for this provider
    /// — drives per-feature "coming soon" gating distinct from `capabilities`.
    pub implemented: Implemented,
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
            implemented: Implemented::for_provider(provider),
        }
    }
}

/// A repository as listed for cloning — neutral across providers (the clone
/// browser's row). GitHub fields map 1:1 from `GhRepo`; GitLab fills it from a
/// `glab` project.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRepo {
    /// "owner/name" (GitHub) or "group/subgroup/name" (GitLab).
    pub full_name: String,
    /// The owning user/org/group namespace.
    pub owner: String,
    pub name: String,
    pub private: bool,
    pub archived: bool,
    pub fork: bool,
    /// HTTPS clone URL.
    pub clone_url: String,
    /// SSH clone URL.
    pub ssh_url: String,
    pub description: Option<String>,
    /// ISO-8601 last-activity/push time, for recency sorting.
    pub pushed_at: Option<String>,
}

/// The signed-in user's repositories on a provider, for the clone browser.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRepoList {
    /// The signed-in user's login, so the UI lists their own repos first.
    pub viewer: String,
    pub repos: Vec<ForgeRepo>,
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

    #[test]
    fn github_has_everything_implemented() {
        let i = Implemented::for_provider(Provider::GitHub);
        assert!(i.pull_requests && i.issues && i.ci && i.releases && i.insights);
        assert!(i.repo_actions && i.publish);
    }

    #[test]
    fn gitlab_implements_mr_issue_ci_and_release_reads_so_far() {
        // GitLab is platform-capable of PRs/issues/CI (capabilities); merge request,
        // issue, CI-pipeline, and release reads are built, so only insights / repo
        // actions still degrade to "coming soon" even when the repo is ready.
        let cap = Capabilities::for_provider(Provider::GitLab);
        let imp = Implemented::for_provider(Provider::GitLab);
        assert!(cap.pull_requests && imp.pull_requests);
        assert!(cap.issues && imp.issues);
        assert!(cap.ci && imp.ci);
        assert!(imp.releases);
        assert!(!imp.insights && !imp.repo_actions && !imp.publish);
    }
}
