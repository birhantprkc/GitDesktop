//! The provider abstraction — one neutral interface over GitHub, GitLab, and
//! Bitbucket so hosted features (PRs/MRs, issues, CI, settings) work regardless of
//! where a repo is hosted.
//!
//! Per `docs/multi-provider-support.md` (decisions locked 2026-06-29): GitHub stays
//! on `gh`, GitLab will use the `glab` CLI, and Bitbucket Cloud will use direct
//! HTTP — all behind the [`Forge`] trait. **Phase 0 ships the scaffold and GitHub
//! impl only**, with zero behavior change: `forge_status` simply produces a neutral
//! [`ForgeStatus`] (GitHub delegates to the existing `gh_status`), and GitLab /
//! Bitbucket are recognized but report not-ready until their impls land.

pub mod github;
pub mod gitlab;
pub mod glab;
pub mod model;

use crate::error::{AppError, AppResult};
use crate::forge::github::GitHubForge;
use crate::forge::gitlab::GitLabForge;
use crate::forge::model::{ForgeRepoList, ForgeStatus, Provider};

/// A hosted-git provider GitDesktop can talk to. One method per hosted capability;
/// the trait grows a method per phase (Phase 0 = `status` only). Called via static
/// dispatch over concrete impls, so there's no `dyn`/async-trait machinery.
#[allow(async_fn_in_trait)]
pub trait Forge {
    /// Whether the hosted integration is usable for this repo, on which host, as
    /// whom, and what it supports.
    async fn status(&self, repo_path: &str) -> AppResult<ForgeStatus>;
}

/// The host of a remote URL — both `https://host[:port]/…` and scp-style
/// `git@host:owner/…`. Lowercased; `None` when there's no parseable host (a local
/// path, say). Tolerates an optional `user@` and a `:port`.
pub(crate) fn remote_host(url: &str) -> Option<String> {
    let url = url.trim();
    // `scheme://[user@]host[:port]/…` → strip the scheme; otherwise treat it as a
    // scp-like `[user@]host:path` and operate on the whole string.
    let rest = url.split_once("://").map_or(url, |(_, after)| after);
    // Drop an optional `user@` (rsplit so `user@host` keeps `host`).
    let rest = rest.rsplit_once('@').map_or(rest, |(_, host)| host);
    // The host ends at the first `/` (path) or `:` (port / scp path separator).
    let host = rest.split(['/', ':']).next().unwrap_or("");
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// The `owner/name` (or `group/subgroup/name`) path of a remote URL — the part
/// after the host, with any `.git` suffix and surrounding slashes trimmed.
/// Complements [`remote_host`]; `None` when there's no path. Handles both
/// `https://host[:port]/path` and scp-style `git@host:path`: with a scheme a `:`
/// is a port (path starts after the next `/`), without one it's the scp path
/// separator. Used to address a repo on a provider's API (e.g. a GitLab project).
pub(crate) fn remote_path(url: &str) -> Option<String> {
    let url = url.trim();
    let (had_scheme, rest) = match url.split_once("://") {
        Some((_, after)) => (true, after),
        None => (false, url),
    };
    // Drop an optional `user@` (rsplit so `user@host` keeps `host`).
    let rest = rest.rsplit_once('@').map_or(rest, |(_, host)| host);
    let path = if had_scheme {
        // `host[:port]/path` → everything after the first `/`.
        rest.split_once('/').map(|(_, after)| after)?
    } else {
        // scp `host:path` → everything after the first `:`.
        rest.split_once(':').map(|(_, after)| after)?
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    (!path.is_empty()).then(|| path.to_string())
}

/// Route a remote host to a **non-GitHub** provider, but only when it's
/// unmistakably GitLab.com or Bitbucket Cloud. github.com, Enterprise servers,
/// self-managed GitLab we can't yet recognize, and unknown hosts all return
/// `None` — so the GitHub path runs and `gh`'s own (Enterprise-aware) detection
/// stays authoritative. Self-managed GitLab gains a user host list in Phase 1.
fn provider_for_host(host: &str) -> Option<Provider> {
    match host {
        "gitlab.com" => Some(Provider::GitLab),
        "bitbucket.org" => Some(Provider::Bitbucket),
        _ => None,
    }
}

/// Detect a non-GitHub provider from the repo's `origin` remote, with its host.
/// `None` (→ GitHub path) when the `origin` URL can't be read (no remote, or any
/// git error), is unparseable, or isn't a canonical GitLab/Bitbucket host — so
/// GitHub stays the resilient default and `gh`'s own detection decides readiness.
async fn detect_non_github(repo_path: &str) -> Option<(Provider, String)> {
    let url = crate::git::remote::git_remote_url(repo_path.to_string(), "origin".to_string())
        .await
        .ok()?;
    let host = remote_host(&url)?;
    provider_for_host(&host).map(|p| (p, host))
}

/// Resolve a repo's hosted-integration status behind the provider abstraction.
/// GitLab/Bitbucket repos are recognized but report not-ready (their impls arrive
/// in Phases 1–4); everything else delegates to the GitHub impl, unchanged.
pub async fn resolve_status(repo_path: &str) -> AppResult<ForgeStatus> {
    if let Some((provider, host)) = detect_non_github(repo_path).await {
        return match provider {
            // GitLab probes glab for install/auth (read ops not built yet, so it
            // reports not-ready); Bitbucket is still a recognized-only stub.
            Provider::GitLab => GitLabForge::new(host).status(repo_path).await,
            _ => Ok(ForgeStatus::unimplemented(provider, host)),
        };
    }
    GitHubForge.status(repo_path).await
}

/// Provider-neutral hosted-integration status for a repo. The frontend gates
/// hosted features on this (and its `capabilities`) instead of a GitHub-only
/// readiness check. Phase 0: GitHub delegates to the existing gh-backed status.
#[tauri::command]
pub async fn forge_status(repo_path: String) -> AppResult<ForgeStatus> {
    resolve_status(&repo_path).await
}

/// The signed-in user's repositories on a provider, for the clone browser.
/// Dispatches by provider — GitHub via `gh`, GitLab via `glab`; Bitbucket isn't
/// implemented yet. Account-scoped (no repo path), unlike `forge_status`.
#[tauri::command]
pub async fn forge_list_repos(provider: Provider) -> AppResult<ForgeRepoList> {
    match provider {
        Provider::GitHub => github::list_repos().await,
        Provider::GitLab => gitlab::list_repos().await,
        Provider::Bitbucket => Err(AppError::InvalidArgument(
            "Bitbucket repository listing isn't supported yet.".into(),
        )),
    }
}

/// Clone a repo, supplying provider auth that plain `git clone` lacks. GitHub
/// (and the URL tab) clone fine via git + the gh credential helper; a private
/// GitLab repo needs glab's token, injected as a ONE-SHOT `git -c` credential
/// helper (no persistent config, no token in the remote URL). Returns the path.
#[tauri::command]
pub async fn forge_clone(
    provider: Provider,
    url: String,
    parent_dir: String,
    dir_name: Option<String>,
) -> AppResult<String> {
    let extra = match provider {
        Provider::GitLab => gitlab::clone_credential_config(&url).await?,
        _ => Vec::new(),
    };
    crate::git::repo::clone_repo_core(&url, &parent_dir, dir_name, &extra).await
}

/// A repo's merge/pull requests, behind the provider abstraction. GitHub
/// delegates to the existing `gh pr list`; GitLab maps `glab` merge requests onto
/// the same neutral [`PrInfo`] shape. `state` is `"open"` or `"closed"` (closed
/// includes merged, matching the GitHub panel's Closed tab).
#[tauri::command]
pub async fn forge_pr_list(
    repo_path: String,
    state: String,
) -> AppResult<Vec<crate::github::pr::PrInfo>> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::list_prs(&repo_path, &state).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::list_prs(&repo_path, &state).await,
    }
}

/// Full details for one merge/pull request's read view, behind the abstraction.
#[tauri::command]
pub async fn forge_pr_view(
    repo_path: String,
    number: u64,
) -> AppResult<crate::github::pr::PrDetails> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::view_pr(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::view_pr(&repo_path, number).await,
    }
}

/// The unified diff for one merge/pull request, behind the abstraction.
#[tauri::command]
pub async fn forge_pr_diff(repo_path: String, number: u64) -> AppResult<String> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::diff_pr(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::diff_pr(&repo_path, number).await,
    }
}

/// Post a comment on a merge/pull request, behind the abstraction. GitHub delegates
/// to `gh pr comment`; GitLab posts a note via `glab`. Merge / approve / review stay
/// GitHub-only (hidden for GitLab on the frontend).
#[tauri::command]
pub async fn forge_pr_comment(repo_path: String, number: u64, body: String) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::comment_mr(&repo_path, number, &body).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::comment_pr(&repo_path, number, &body).await,
    }
}

/// Close a merge/pull request (not merge), behind the abstraction.
#[tauri::command]
pub async fn forge_pr_close(repo_path: String, number: u64) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::close_mr(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::close_pr(&repo_path, number).await,
    }
}

/// Reopen a closed (not merged) merge/pull request, behind the abstraction.
#[tauri::command]
pub async fn forge_pr_reopen(repo_path: String, number: u64) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::reopen_mr(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::reopen_pr(&repo_path, number).await,
    }
}

/// A repo's issues, behind the provider abstraction. GitHub delegates to the
/// existing `gh issue list`; GitLab maps `glab` issues onto the same neutral
/// [`IssueInfo`](crate::github::issue::IssueInfo). `state` is `"open"` or
/// `"closed"`. Issue *writes* stay GitHub-only (hidden for GitLab on the frontend).
#[tauri::command]
pub async fn forge_issue_list(
    repo_path: String,
    state: String,
) -> AppResult<Vec<crate::github::issue::IssueInfo>> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::list_issues(&repo_path, &state).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => github::list_issues(&repo_path, &state).await,
    }
}

/// Full details for one issue's read view, behind the abstraction.
#[tauri::command]
pub async fn forge_issue_view(
    repo_path: String,
    number: u64,
) -> AppResult<crate::github::issue::IssueDetails> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::view_issue(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => github::view_issue(&repo_path, number).await,
    }
}

/// A repo's CI runs, behind the provider abstraction. GitHub delegates to
/// `gh run list`; GitLab maps `glab` pipelines onto the same neutral
/// [`WorkflowRun`](crate::github::actions::WorkflowRun). `limit` caps the count;
/// `branch` optionally scopes to one ref. Reads only — re-run / cancel / dispatch
/// stay GitHub-only.
#[tauri::command]
pub async fn forge_ci_run_list(
    repo_path: String,
    limit: u32,
    branch: Option<String>,
) -> AppResult<Vec<crate::github::actions::WorkflowRun>> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::list_runs(&repo_path, limit, branch).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket pipelines aren't supported yet.".into(),
        )),
        _ => github::list_runs(&repo_path, limit, branch).await,
    }
}

/// One CI run with its jobs, behind the abstraction.
#[tauri::command]
pub async fn forge_ci_run_view(
    repo_path: String,
    run_id: u64,
) -> AppResult<crate::github::actions::RunDetail> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::view_run(&repo_path, run_id).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket pipelines aren't supported yet.".into(),
        )),
        _ => github::view_run(&repo_path, run_id).await,
    }
}

/// The failed jobs' logs for one CI run, behind the abstraction.
#[tauri::command]
pub async fn forge_ci_run_failed_logs(repo_path: String, run_id: u64) -> AppResult<String> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::run_failed_logs(&repo_path, run_id).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket pipelines aren't supported yet.".into(),
        )),
        _ => github::run_failed_logs(&repo_path, run_id).await,
    }
}

/// One CI job's log, behind the abstraction.
#[tauri::command]
pub async fn forge_ci_job_logs(repo_path: String, job_id: u64) -> AppResult<String> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::job_logs(&repo_path, job_id).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket pipelines aren't supported yet.".into(),
        )),
        _ => github::job_logs(&repo_path, job_id).await,
    }
}

/// A repo's releases (list view), behind the provider abstraction. GitHub delegates
/// to `gh release list`; GitLab maps `glab` releases onto the same neutral
/// [`ReleaseInfo`](crate::github::release::ReleaseInfo). Reads only — create / edit /
/// delete / asset management stay GitHub-only (hidden for GitLab on the frontend).
#[tauri::command]
pub async fn forge_release_list(
    repo_path: String,
) -> AppResult<Vec<crate::github::release::ReleaseInfo>> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::list_releases(&repo_path).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket releases aren't supported yet.".into(),
        )),
        _ => github::list_releases(&repo_path).await,
    }
}

/// Full details for one release's read view, by its tag, behind the abstraction.
#[tauri::command]
pub async fn forge_release_view(
    repo_path: String,
    tag: String,
) -> AppResult<crate::github::release::ReleaseDetails> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::view_release(&repo_path, &tag).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket releases aren't supported yet.".into(),
        )),
        _ => github::view_release(&repo_path, &tag).await,
    }
}

/// Post a comment on an issue, behind the provider abstraction — the first GitLab
/// WRITE. GitHub delegates to `gh issue comment`; GitLab posts a note via `glab`.
#[tauri::command]
pub async fn forge_issue_comment(repo_path: String, number: u64, body: String) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::comment_issue(&repo_path, number, &body).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => github::comment_issue(&repo_path, number, &body).await,
    }
}

/// Close an issue, behind the abstraction. `reason` is GitHub's close reason
/// (`completed`/`not_planned`); GitLab has no close reason and ignores it.
#[tauri::command]
pub async fn forge_issue_close(repo_path: String, number: u64, reason: String) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::close_issue(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => github::close_issue(&repo_path, number, &reason).await,
    }
}

/// Reopen a closed issue, behind the abstraction.
#[tauri::command]
pub async fn forge_issue_reopen(repo_path: String, number: u64) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::reopen_issue(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => github::reopen_issue(&repo_path, number).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_host_parses_https_and_ssh_forms() {
        assert_eq!(remote_host("https://github.com/o/r").as_deref(), Some("github.com"));
        assert_eq!(
            remote_host("https://gitlab.acme.com:8443/g/s/r.git").as_deref(),
            Some("gitlab.acme.com"),
        );
        assert_eq!(remote_host("git@github.com:o/r.git").as_deref(), Some("github.com"));
        assert_eq!(remote_host("ssh://git@gitlab.com/g/r.git").as_deref(), Some("gitlab.com"));
        // Mixed case is normalized.
        assert_eq!(remote_host("https://GitLab.com/o/r").as_deref(), Some("gitlab.com"));
        // No host → None (local path).
        assert_eq!(remote_host("/local/path"), None);
    }

    #[test]
    fn only_canonical_hosts_route_away_from_github() {
        assert_eq!(provider_for_host("gitlab.com"), Some(Provider::GitLab));
        assert_eq!(provider_for_host("bitbucket.org"), Some(Provider::Bitbucket));
        // GitHub.com + Enterprise + self-managed GitLab → None (gh / Phase 1 decide).
        assert_eq!(provider_for_host("github.com"), None);
        assert_eq!(provider_for_host("github.acme.com"), None);
        assert_eq!(provider_for_host("gitlab.acme.com"), None);
    }

    #[test]
    fn remote_path_extracts_project_path() {
        // https, with and without .git, default and custom port.
        assert_eq!(remote_path("https://gitlab.com/group/repo.git").as_deref(), Some("group/repo"));
        assert_eq!(remote_path("https://gitlab.com/group/repo").as_deref(), Some("group/repo"));
        assert_eq!(
            remote_path("https://gitlab.acme.com:8443/g/sub/repo.git").as_deref(),
            Some("g/sub/repo"),
        );
        // scp form keeps the nested group path.
        assert_eq!(remote_path("git@gitlab.com:group/sub/repo.git").as_deref(), Some("group/sub/repo"));
        assert_eq!(remote_path("ssh://git@gitlab.com/group/repo.git").as_deref(), Some("group/repo"));
        // host only → no path.
        assert_eq!(remote_path("https://gitlab.com"), None);
        assert_eq!(remote_path("/local/path"), None);
    }
}
