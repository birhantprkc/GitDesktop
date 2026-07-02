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
    // ── Reads (panel-level): whether we fetch+render this surface at all. ──
    pub pull_requests: bool,
    pub issues: bool,
    pub ci: bool,
    pub releases: bool,
    pub insights: bool,
    /// Repo-management surface: View/Fork/Star/admin settings, branch-rule import.
    pub repo_actions: bool,
    /// Publishing a local repo to the provider (create remote + push).
    pub publish: bool,
    /// The repository-settings dialog (admin probe + General / Danger zone,
    /// plus each provider's extra sections). Distinct from `repo_actions` so a
    /// provider can have View/Star without the settings surface.
    pub repo_settings: bool,
    // ── Writes (per-action): flip on as each mutation lands for a provider, so a
    //    read-only provider's detail views suppress just the writes it can't do
    //    yet (distinct from the panel-level read flags above). ──
    /// Posting a comment/note on an issue.
    pub issue_comment: bool,
    /// Closing / reopening an issue.
    pub issue_state: bool,
    /// Posting a comment/note on a merge/pull request.
    pub mr_comment: bool,
    /// Closing / reopening a merge/pull request (not merge).
    pub mr_state: bool,
    /// Approving / unapproving a merge request via the bodyless toggle. GitLab-only:
    /// GitHub surfaces approval through the older review flow (the Review menu), not
    /// this control, so it's the one write GitHub leaves `false` (see `all`).
    pub mr_approve: bool,
    /// Merging a merge/pull request (strategy + delete-source-branch). A shared
    /// control — GitHub via `gh pr merge`, GitLab via `glab` — so it's true for both.
    pub mr_merge: bool,
    /// Editing labels on an issue — a shared control (GitHub by node id, GitLab by
    /// name), so true for both.
    pub issue_labels: bool,
    /// Editing labels on a merge/pull request — the same shared label control.
    pub mr_labels: bool,
    /// Setting an issue's assignees — a shared issue control. (MR assignees are the
    /// separate GitLab-only `mr_assignees` below — GitHub PRs have no picker here.)
    pub issue_assignees: bool,
    /// Creating an issue from the app — a shared control (the same create dialog;
    /// the GitHub-only org issue type hides per provider — milestone works on both).
    pub issue_create: bool,
    /// Creating a merge/pull request from the app (push the head branch + open) —
    /// a shared control.
    pub mr_create: bool,
    /// Re-running a finished CI run — a shared control. GitHub re-runs all or just
    /// failed jobs; GitLab's retry restarts failed/canceled jobs only (there is no
    /// GitLab "re-run all", so that one button stays GitHub-only in the UI).
    pub ci_rerun: bool,
    /// Cancelling an in-flight CI run — a shared control.
    pub ci_cancel: bool,
    /// Manually starting a CI run — a shared control (GitHub dispatches a workflow;
    /// GitLab runs a new pipeline on a ref, with variables instead of inputs).
    pub ci_dispatch: bool,
    /// Publishing a new release — a shared control (the same create dialog; the
    /// GitHub-only draft/pre-release/latest toggles hide per provider).
    pub release_create: bool,
    /// Managing an existing release (edit title/notes, delete, upload assets,
    /// delete assets) — a shared control.
    pub release_edit: bool,
    /// Setting a merge request's assignees. GitLab-only: GitHub PRs expose no
    /// assignee picker in this app (issue assignees are the shared control), so
    /// like `mr_approve` this flag stays `false` for GitHub (see `all`).
    pub mr_assignees: bool,
    /// Requesting changes on a merge request — the blocking reviewer state.
    /// GitLab-only like `mr_approve`: GitHub requests changes through its Review
    /// menu (`gh_pr_review`), not this control, so the flag stays `false` for
    /// GitHub (see `all`).
    pub mr_request_changes: bool,
    /// Editing an existing issue's title/body — a shared control (the same edit
    /// dialog; GitHub PATCHes the issue, GitLab PUTs title/description).
    pub issue_edit: bool,
    /// Editing an existing merge/pull request's title/body — the same shared
    /// edit control.
    pub mr_edit: bool,
    /// Setting or clearing an issue's milestone — a shared control (the same
    /// picker; GitHub keys on the milestone number, GitLab on the GLOBAL
    /// milestone id, which is what each provider's list read returns).
    pub issue_milestone: bool,
    /// Reactions on an issue and its comments — a shared control (the same
    /// ReactionBar; GitHub reacts by GraphQL node id, GitLab awards emoji by
    /// issue/note id).
    pub issue_reactions: bool,
    /// Reactions on a merge/pull request and its comments — the same shared
    /// ReactionBar.
    pub mr_reactions: bool,
    /// Locking / unlocking an issue's conversation — a shared control (GitHub
    /// locks with an optional reason; GitLab's `discussion_locked` has none, so
    /// the reason submenu hides per provider).
    pub issue_lock: bool,
    /// Moving an issue to another repository/project — a shared control
    /// (GitHub calls it transfer, GitLab move; same dialog).
    pub issue_transfer: bool,
    /// Permanently deleting an issue — a shared control (both providers
    /// restrict it server-side to elevated roles).
    pub issue_delete: bool,
}

impl Implemented {
    /// Everything built — the GitHub reference profile. The one exception is
    /// `mr_approve`: GitHub's approval surface is the older review flow (the Review
    /// menu), not the bodyless approve/unapprove toggle, so that forge control is
    /// GitLab-only and stays `false` here.
    const fn all() -> Self {
        Self {
            pull_requests: true,
            issues: true,
            ci: true,
            releases: true,
            insights: true,
            repo_actions: true,
            publish: true,
            repo_settings: true,
            issue_comment: true,
            issue_state: true,
            mr_comment: true,
            mr_state: true,
            mr_approve: false,
            mr_merge: true,
            issue_labels: true,
            mr_labels: true,
            issue_assignees: true,
            issue_create: true,
            mr_create: true,
            ci_rerun: true,
            ci_cancel: true,
            ci_dispatch: true,
            release_create: true,
            release_edit: true,
            // Like `mr_approve`: GitHub PRs have no assignee picker in this app, so
            // the MR-assignees control is GitLab-only.
            mr_assignees: false,
            // Like `mr_approve`: GitHub requests changes via its Review menu.
            mr_request_changes: false,
            issue_edit: true,
            mr_edit: true,
            issue_milestone: true,
            issue_reactions: true,
            mr_reactions: true,
            issue_lock: true,
            issue_transfer: true,
            issue_delete: true,
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
            repo_settings: false,
            issue_comment: false,
            issue_state: false,
            mr_comment: false,
            mr_state: false,
            mr_approve: false,
            mr_merge: false,
            issue_labels: false,
            mr_labels: false,
            issue_assignees: false,
            issue_create: false,
            mr_create: false,
            ci_rerun: false,
            ci_cancel: false,
            ci_dispatch: false,
            release_create: false,
            release_edit: false,
            mr_assignees: false,
            mr_request_changes: false,
            issue_edit: false,
            mr_edit: false,
            issue_milestone: false,
            issue_reactions: false,
            mr_reactions: false,
            issue_lock: false,
            issue_transfer: false,
            issue_delete: false,
        }
    }

    /// What's built for a provider today. The single place to flip a GitLab /
    /// Bitbucket feature on as its impl lands — bump the flag here and the matching
    /// panel stops degrading to "coming soon".
    pub const fn for_provider(provider: Provider) -> Self {
        match provider {
            Provider::GitHub => Self::all(),
            // GitLab reads are fully wired — merge requests, issues, CI
            // pipelines, releases, and insights. WRITES land
            // per-action: issue + MR comment and close/reopen, the GitLab-only MR
            // approve/unapprove toggle, request-changes, and MR assignees, MR
            // merge, issue + MR labels, issue assignees, issue/MR create, issue +
            // MR title/body edit, issue milestone, award-emoji reactions, issue
            // lock / move / delete, pipeline
            // retry / cancel / run, and release create / edit / delete / assets.
            Provider::GitLab => Self {
                pull_requests: true,
                issues: true,
                ci: true,
                releases: true,
                // The board's core charts are local git; the CI card rides the
                // forge pipeline read. The GitHub-only cards (community /
                // traffic / dependencies) hide per provider in the component.
                insights: true,
                // View/star (fork is a web link-out; branch-rule import stays
                // GitHub-only via a provider guard).
                repo_actions: true,
                publish: true,
                // The settings dialog: General + Danger zone (and the GitLab
                // sections as they land), gated by the Maintainer/Owner probe.
                repo_settings: true,
                issue_comment: true,
                issue_state: true,
                mr_comment: true,
                mr_state: true,
                mr_approve: true,
                mr_merge: true,
                issue_labels: true,
                mr_labels: true,
                issue_assignees: true,
                issue_create: true,
                mr_create: true,
                ci_rerun: true,
                ci_cancel: true,
                ci_dispatch: true,
                release_create: true,
                release_edit: true,
                mr_assignees: true,
                mr_request_changes: true,
                issue_edit: true,
                mr_edit: true,
                issue_milestone: true,
                issue_reactions: true,
                mr_reactions: true,
                issue_lock: true,
                issue_transfer: true,
                issue_delete: true,
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
        // The lone exception: the bodyless approve/unapprove toggle is GitLab-only
        // (GitHub approves via the review flow), so GitHub leaves `mr_approve` false.
        assert!(!i.mr_approve);
        // Labels (issue + MR) and issue assignees are shared controls — built for both.
        assert!(i.issue_labels && i.mr_labels && i.issue_assignees);
        assert!(i.issue_create && i.mr_create);
        // CI actions and release management are shared controls too.
        assert!(i.ci_rerun && i.ci_cancel && i.ci_dispatch);
        assert!(i.release_create && i.release_edit);
        // MR assignees and request-changes mirror mr_approve: GitLab-only controls
        // (GitHub's analogues live in its own Review menu / nowhere), so GitHub
        // stays false.
        assert!(!i.mr_assignees && !i.mr_request_changes);
        // Title/body editing, issue milestones, and reactions are shared controls.
        assert!(i.issue_edit && i.mr_edit && i.issue_milestone);
        assert!(i.issue_reactions && i.mr_reactions);
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
        // Every panel is wired now — insights (local charts + CI card), repo
        // actions (view/star), and publish.
        assert!(imp.insights && imp.repo_actions && imp.publish);
        // First WRITES: issue + MR comment and close/reopen are wired up for GitLab,
        // plus the GitLab-only MR approve/unapprove toggle and MR merge.
        assert!(imp.issue_comment && imp.issue_state);
        assert!(imp.mr_comment && imp.mr_state && imp.mr_approve && imp.mr_merge);
        // Labels (issue + MR) and issue assignees now wired for GitLab too.
        assert!(imp.issue_labels && imp.mr_labels && imp.issue_assignees);
        // …and creating issues + merge requests from the app.
        assert!(imp.issue_create && imp.mr_create);
        // …and pipeline retry/cancel/run, release management, and the GitLab-only
        // MR assignees picker.
        assert!(imp.ci_rerun && imp.ci_cancel && imp.ci_dispatch);
        assert!(imp.release_create && imp.release_edit);
        assert!(imp.mr_assignees);
        // …and title/body editing plus issue milestones.
        assert!(imp.issue_edit && imp.mr_edit && imp.issue_milestone);
        // …and the GitLab-only request-changes reviewer state.
        assert!(imp.mr_request_changes);
        // …and award-emoji reactions on issues and MRs.
        assert!(imp.issue_reactions && imp.mr_reactions);
    }

    #[test]
    fn github_implements_issue_and_mr_writes_bitbucket_does_not() {
        let gh = Implemented::for_provider(Provider::GitHub);
        assert!(gh.issue_comment && gh.issue_state && gh.mr_comment && gh.mr_state);
        // MR merge is a shared control (both providers); approve/unapprove is the one
        // GitLab-only write — GitHub approves via the review flow, not this toggle.
        assert!(gh.mr_merge && !gh.mr_approve);
        let bb = Implemented::for_provider(Provider::Bitbucket);
        assert!(!bb.issue_comment && !bb.issue_state && !bb.mr_comment && !bb.mr_state);
        assert!(!bb.mr_approve && !bb.mr_merge);
        assert!(!bb.issue_labels && !bb.mr_labels && !bb.issue_assignees);
        assert!(!bb.issue_create && !bb.mr_create);
        assert!(!bb.ci_rerun && !bb.ci_cancel && !bb.ci_dispatch);
        assert!(!bb.release_create && !bb.release_edit && !bb.mr_assignees);
        assert!(!bb.issue_edit && !bb.mr_edit && !bb.issue_milestone);
        assert!(!bb.mr_request_changes);
        assert!(!bb.issue_reactions && !bb.mr_reactions);
    }
}
