//! The GitHub [`Forge`](super::Forge) implementation.
//!
//! GitHub already works and ships, and `gh` handles Enterprise hosts and
//! multi-account auth for free — so this impl is a **thin adapter** over the
//! existing `github::*` (gh-CLI-backed) code, never a rewrite. Phase 0 only maps
//! `gh_status` → the neutral [`ForgeStatus`]; later phases add the PR/issue/CI
//! methods, each delegating to the matching `gh_*` function.

use crate::error::AppResult;
use crate::forge::model::{Capabilities, ForgeRepo, ForgeRepoList, ForgeStatus, Implemented, Provider};
use crate::forge::Forge;
use crate::github::pr::{gh_list_repos, gh_status, GhRepo, GhStatus};

/// GitHub via the `gh` CLI. Unit struct — `gh` carries all the state (auth, host).
pub struct GitHubForge;

/// Map the GitHub-shaped `GhStatus` onto the neutral `ForgeStatus`. Pure (no I/O)
/// so it's unit-testable: a repo `gh` recognizes is a GitHub repo with the full
/// capability set; an unrecognized one carries no provider and no capabilities,
/// matching `gh_status`'s own `repo: None`.
pub(crate) fn from_gh_status(gh: GhStatus) -> ForgeStatus {
    let provider = gh.repo.as_ref().map(|_| Provider::GitHub);
    ForgeStatus {
        provider,
        installed: gh.installed,
        authenticated: gh.authenticated,
        repo: gh.repo,
        host: gh.host,
        login: gh.login,
        capabilities: match provider {
            Some(p) => Capabilities::for_provider(p),
            None => Capabilities::none(),
        },
        implemented: match provider {
            Some(p) => Implemented::for_provider(p),
            None => Implemented::none(),
        },
    }
}

impl Forge for GitHubForge {
    async fn status(&self, repo_path: &str) -> AppResult<ForgeStatus> {
        // Delegate to the existing gh-backed status (Enterprise- and
        // multi-account-aware) and normalize its result.
        Ok(from_gh_status(gh_status(repo_path.to_string()).await?))
    }
}

/// Map a GitHub repo (gh shape) onto the neutral [`ForgeRepo`] — 1:1, since the
/// neutral model was sized from `GhRepo`.
fn from_gh_repo(r: GhRepo) -> ForgeRepo {
    ForgeRepo {
        full_name: r.name_with_owner,
        owner: r.owner,
        name: r.name,
        private: r.private,
        archived: r.archived,
        fork: r.fork,
        clone_url: r.clone_url,
        ssh_url: r.ssh_url,
        description: r.description,
        pushed_at: r.pushed_at,
    }
}

/// The signed-in GitHub user's repositories, for the clone browser — delegates to
/// the existing `gh_list_repos` and normalizes.
pub async fn list_repos() -> AppResult<ForgeRepoList> {
    let gh = gh_list_repos().await?;
    Ok(ForgeRepoList {
        viewer: gh.viewer,
        repos: gh.repos.into_iter().map(from_gh_repo).collect(),
    })
}

// ── Pull requests ────────────────────────────────────────────────────────────
//
// Thin delegates to the existing gh-backed commands. The frontend already speaks
// `PrInfo`/`PrDetails`, so the GitHub path is byte-identical to calling `gh_pr_*`
// directly — the abstraction adds the dispatch seam without changing GitHub.

pub async fn list_prs(repo_path: &str, state: &str) -> AppResult<Vec<crate::github::pr::PrInfo>> {
    crate::github::pr::gh_pr_list(repo_path.to_string(), state.to_string()).await
}

pub async fn view_pr(repo_path: &str, number: u64) -> AppResult<crate::github::pr::PrDetails> {
    crate::github::pr::gh_pr_view(repo_path.to_string(), number).await
}

pub async fn diff_pr(repo_path: &str, number: u64) -> AppResult<String> {
    crate::github::pr::gh_pr_diff(repo_path.to_string(), number).await
}

// ── Merge requests (write) ───────────────────────────────────────────────────
//
// Thin delegates to the existing gh-backed PR mutations — comment + close/reopen,
// the first MR writes fronted behind the abstraction. Merge / approve / review /
// edit stay GitHub-only and aren't fronted here.

pub async fn comment_pr(repo_path: &str, number: u64, body: &str) -> AppResult<()> {
    crate::github::pr::gh_pr_comment(repo_path.to_string(), number, body.to_string()).await
}

pub async fn close_pr(repo_path: &str, number: u64) -> AppResult<()> {
    crate::github::pr::gh_pr_close(repo_path.to_string(), number).await
}

pub async fn reopen_pr(repo_path: &str, number: u64) -> AppResult<()> {
    crate::github::pr::gh_pr_reopen(repo_path.to_string(), number).await
}

// ── Issues (read) ────────────────────────────────────────────────────────────
//
// Thin delegates to the existing gh-backed issue commands, mirroring the PR ones.

pub async fn list_issues(
    repo_path: &str,
    state: &str,
) -> AppResult<Vec<crate::github::issue::IssueInfo>> {
    crate::github::issue::gh_issue_list(repo_path.to_string(), state.to_string()).await
}

pub async fn view_issue(
    repo_path: &str,
    number: u64,
) -> AppResult<crate::github::issue::IssueDetails> {
    crate::github::issue::gh_issue_view(repo_path.to_string(), number).await
}

// ── CI / Actions (read) ──────────────────────────────────────────────────────
//
// Thin delegates to the existing gh-backed Actions reads, mirroring the PR/issue
// ones. The write commands (re-run, cancel, dispatch) stay GitHub-only and aren't
// fronted here.

pub async fn list_runs(
    repo_path: &str,
    limit: u32,
    branch: Option<String>,
) -> AppResult<Vec<crate::github::actions::WorkflowRun>> {
    crate::github::actions::gh_run_list(repo_path.to_string(), limit, branch).await
}

pub async fn view_run(
    repo_path: &str,
    run_id: u64,
) -> AppResult<crate::github::actions::RunDetail> {
    crate::github::actions::gh_run_view(repo_path.to_string(), run_id).await
}

pub async fn run_failed_logs(repo_path: &str, run_id: u64) -> AppResult<String> {
    crate::github::actions::gh_run_failed_logs(repo_path.to_string(), run_id).await
}

pub async fn job_logs(repo_path: &str, job_id: u64) -> AppResult<String> {
    crate::github::actions::gh_job_logs(repo_path.to_string(), job_id).await
}

// ── Releases (read) ──────────────────────────────────────────────────────────
//
// Thin delegates to the existing gh-backed release reads. Create / edit / delete
// and the asset commands stay GitHub-only and aren't fronted here.

pub async fn list_releases(repo_path: &str) -> AppResult<Vec<crate::github::release::ReleaseInfo>> {
    crate::github::release::gh_release_list(repo_path.to_string()).await
}

pub async fn view_release(
    repo_path: &str,
    tag: &str,
) -> AppResult<crate::github::release::ReleaseDetails> {
    crate::github::release::gh_release_view(repo_path.to_string(), tag.to_string()).await
}

// ── Issues (write) ───────────────────────────────────────────────────────────
//
// Thin delegates to the existing gh-backed issue mutations — the first writes
// fronted behind the abstraction. The rest of the issue write surface (labels,
// assignees, edit, reactions, pin/lock, …) stays GitHub-only and isn't fronted.

pub async fn comment_issue(repo_path: &str, number: u64, body: &str) -> AppResult<()> {
    crate::github::issue::gh_issue_comment(repo_path.to_string(), number, body.to_string()).await
}

pub async fn close_issue(repo_path: &str, number: u64, reason: &str) -> AppResult<()> {
    crate::github::issue::gh_issue_close(repo_path.to_string(), number, reason.to_string()).await
}

pub async fn reopen_issue(repo_path: &str, number: u64) -> AppResult<()> {
    crate::github::issue::gh_issue_reopen(repo_path.to_string(), number).await
}

// ── Labels & assignees (read + write) ─────────────────────────────────────────
//
// Thin delegates to the existing gh-backed label/assignee commands. Labels are a
// shared control on both issues and MRs (GitHub keys them by GraphQL node id); issue
// assignees are a shared issue control. GitHub is byte-identical to calling the
// `gh_*` commands directly — the abstraction only adds the dispatch seam.

pub async fn repo_labels(repo_path: &str) -> AppResult<Vec<crate::github::pr::RepoLabel>> {
    crate::github::pr::gh_repo_labels(repo_path.to_string()).await
}

pub async fn assignable_users(repo_path: &str) -> AppResult<Vec<String>> {
    crate::github::issue::gh_assignable_users(repo_path.to_string()).await
}

pub async fn edit_labels(
    repo_path: &str,
    labelable_id: &str,
    add_ids: Vec<String>,
    remove_ids: Vec<String>,
) -> AppResult<()> {
    crate::github::pr::gh_pr_edit_labels(
        repo_path.to_string(),
        labelable_id.to_string(),
        add_ids,
        remove_ids,
    )
    .await
}

pub async fn set_issue_assignees(
    repo_path: &str,
    number: u64,
    assignees: Vec<String>,
) -> AppResult<()> {
    crate::github::issue::gh_issue_set_assignees(repo_path.to_string(), number, assignees).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognized_repo_maps_to_github_with_full_capabilities() {
        let gh = GhStatus {
            installed: true,
            authenticated: true,
            repo: Some("owner/name".into()),
            host: Some("github.com".into()),
            login: Some("me".into()),
        };
        let f = from_gh_status(gh);
        assert_eq!(f.provider, Some(Provider::GitHub));
        assert_eq!(f.repo.as_deref(), Some("owner/name"));
        assert_eq!(f.host.as_deref(), Some("github.com"));
        assert!(f.installed && f.authenticated);
        assert!(f.capabilities.discussions && f.capabilities.pull_requests);
    }

    #[test]
    fn unrecognized_repo_has_no_provider_or_capabilities() {
        // gh installed + signed in, but this folder isn't a GitHub repo.
        let gh = GhStatus {
            installed: true,
            authenticated: true,
            repo: None,
            host: None,
            login: None,
        };
        let f = from_gh_status(gh);
        assert_eq!(f.provider, None);
        assert!(f.installed && f.authenticated);
        assert!(!f.capabilities.pull_requests && !f.capabilities.ci);
    }
}
