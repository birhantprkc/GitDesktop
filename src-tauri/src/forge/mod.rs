//! The provider abstraction — one neutral interface over GitHub, GitLab, and
//! Bitbucket so hosted features (PRs/MRs, issues, CI, settings) work regardless of
//! where a repo is hosted.
//!
//! Per `docs/multi-provider-support.md` (decisions locked 2026-06-29): GitHub stays
//! on `gh`, GitLab uses the `glab` CLI, and Bitbucket Cloud (not yet built) will use
//! direct HTTP — all behind the [`Forge`] trait. Each `forge_*` command dispatches
//! on the detected provider: the GitHub arm delegates to the existing `gh_*`
//! commands (byte-identical), the GitLab arm to `gitlab.rs`. Which features each
//! provider has wired up is declared in `model.rs::Implemented`.

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

/// Open merge/pull requests whose head is `head`, behind the abstraction — the
/// ComparePanel duplicate probe ("View" instead of "Create" once one exists).
#[tauri::command]
pub async fn forge_prs_for_branch(
    repo_path: String,
    head: String,
) -> AppResult<Vec<crate::github::pr::PrInfo>> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::prs_for_branch(&repo_path, &head).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::prs_for_branch(&repo_path, &head).await,
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
/// to `gh pr comment`; GitLab posts a note via `glab`. (Full reviews stay
/// GitHub-only — approve/merge/edit each have their own forge command.)
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

/// Request changes on a merge request (the blocking reviewer state), with an
/// optional comment. GitLab-only, like the approve/unapprove toggle: GitHub
/// requests changes through its own Review menu (`gh_pr_review`), and the
/// frontend gates this on `implemented.mrRequestChanges` (false for GitHub), so
/// the GitHub arm is never reached — it errors defensively.
#[tauri::command]
pub async fn forge_pr_request_changes(
    repo_path: String,
    number: u64,
    body: String,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::request_changes_mr(&repo_path, number, &body).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => Err(AppError::InvalidArgument(
            "GitHub requests changes through the Review menu.".into(),
        )),
    }
}

/// Edit a merge/pull request's title/body, behind the abstraction — the shared
/// edit dialog. GitHub PATCHes the pull; GitLab PUTs title/description.
#[tauri::command]
pub async fn forge_pr_edit(
    repo_path: String,
    number: u64,
    title: String,
    body: String,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::edit_mr(&repo_path, number, &title, &body).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::edit_pr(&repo_path, number, &title, &body).await,
    }
}

/// The viewer's + the MR's approval state, behind the abstraction. GitLab-only:
/// GitHub surfaces approval through the review flow (`reviewDecision` + the Review
/// menu), so its arm errors — the frontend gates this on `implemented.mrApprove`
/// (false for GitHub), so it's never reached there.
#[tauri::command]
pub async fn forge_pr_approvals(
    repo_path: String,
    number: u64,
) -> AppResult<crate::github::pr::ApprovalState> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::pr_approvals(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => Err(AppError::InvalidArgument(
            "GitHub surfaces approval through the review flow, not this control.".into(),
        )),
    }
}

/// Approve a merge request (a bodyless GitLab reviewer action), behind the
/// abstraction. GitLab-only — GitHub approves via the review flow.
#[tauri::command]
pub async fn forge_pr_approve(repo_path: String, number: u64) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::approve_pr(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => Err(AppError::InvalidArgument(
            "GitHub approvals go through the review flow, not this control.".into(),
        )),
    }
}

/// Revoke the viewer's approval of a merge request, behind the abstraction.
/// GitLab-only.
#[tauri::command]
pub async fn forge_pr_unapprove(repo_path: String, number: u64) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::unapprove_pr(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => Err(AppError::InvalidArgument(
            "GitHub approvals go through the review flow, not this control.".into(),
        )),
    }
}

/// Merge a merge/pull request, behind the abstraction. GitHub delegates to the
/// existing `gh pr merge` UNCHANGED (it has no `sha` guard, so it's dropped); GitLab
/// merges via `glab` — `merge`/`squash` only (no per-MR rebase) with an optional
/// head-`sha` stale-view guard. `strategy` is `merge`/`squash`/`rebase` (rebase is
/// GitHub-only; the GitLab arm rejects it).
#[tauri::command]
pub async fn forge_pr_merge(
    repo_path: String,
    number: u64,
    strategy: String,
    delete_branch: bool,
    sha: Option<String>,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::merge_mr(&repo_path, number, &strategy, delete_branch, sha.as_deref()).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => crate::github::pr::gh_pr_merge(repo_path, number, strategy, delete_branch).await,
    }
}

/// A repo's issues, behind the provider abstraction. GitHub delegates to the
/// existing `gh issue list`; GitLab maps `glab` issues onto the same neutral
/// [`IssueInfo`](crate::github::issue::IssueInfo). `state` is `"open"` or
/// `"closed"`.
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
/// `branch` optionally scopes to one ref.
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

/// Re-run a finished CI run, behind the abstraction. GitHub re-runs all jobs or
/// (`failed`) just the failed ones; GitLab's retry restarts failed + canceled jobs
/// only — its single semantic — so the GitLab arm ignores `failed` (the UI only
/// offers the retry button there; "re-run all" stays GitHub-only).
#[tauri::command]
pub async fn forge_ci_run_rerun(repo_path: String, run_id: u64, failed: bool) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::retry_run(&repo_path, run_id).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket pipelines aren't supported yet.".into(),
        )),
        _ => github::rerun_run(&repo_path, run_id, failed).await,
    }
}

/// Cancel an in-flight CI run, behind the abstraction.
#[tauri::command]
pub async fn forge_ci_run_cancel(repo_path: String, run_id: u64) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::cancel_run(&repo_path, run_id).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket pipelines aren't supported yet.".into(),
        )),
        _ => github::cancel_run(&repo_path, run_id).await,
    }
}

/// Manually start a CI run, behind the abstraction. GitHub dispatches `workflow`
/// (id or file name) on `git_ref` with `inputs`; GitLab runs a new pipeline on the
/// ref with `inputs` as CI/CD variables — it has no per-workflow dispatch, so the
/// GitLab arm ignores `workflow` (the UI sends it empty there).
#[tauri::command]
pub async fn forge_ci_dispatch(
    repo_path: String,
    workflow: String,
    git_ref: String,
    inputs: std::collections::HashMap<String, String>,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::run_pipeline(&repo_path, &git_ref, &inputs).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket pipelines aren't supported yet.".into(),
        )),
        _ => github::dispatch_ci(&repo_path, &workflow, &git_ref, inputs).await,
    }
}

/// A repo's releases (list view), behind the provider abstraction. GitHub delegates
/// to `gh release list`; GitLab maps `glab` releases onto the same neutral
/// [`ReleaseInfo`](crate::github::release::ReleaseInfo).
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

/// Publish a release, behind the abstraction; returns its web URL. The
/// draft / prerelease / latest toggles are GitHub concepts — GitLab has none of
/// the three, so its arm drops them (the create dialog hides those fields there,
/// like the issue dialog's milestone/type).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn forge_release_create(
    repo_path: String,
    tag: String,
    title: String,
    notes: String,
    target: String,
    prerelease: bool,
    draft: bool,
    latest: bool,
) -> AppResult<String> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::create_release(&repo_path, &tag, &title, &notes, &target).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket releases aren't supported yet.".into(),
        )),
        _ => {
            github::create_release(
                &repo_path, &tag, &title, &notes, &target, prerelease, draft, latest,
            )
            .await
        }
    }
}

/// Edit a release's title/notes (GitHub also its draft/prerelease/latest state),
/// behind the abstraction. The GitLab arm drops the GitHub-only toggles.
#[tauri::command]
pub async fn forge_release_edit(
    repo_path: String,
    tag: String,
    title: String,
    notes: String,
    prerelease: bool,
    draft: bool,
    latest: bool,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::edit_release(&repo_path, &tag, &title, &notes).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket releases aren't supported yet.".into(),
        )),
        _ => github::edit_release(&repo_path, &tag, &title, &notes, prerelease, draft, latest).await,
    }
}

/// Delete a release (optionally its git tag too), behind the abstraction.
#[tauri::command]
pub async fn forge_release_delete(
    repo_path: String,
    tag: String,
    cleanup_tag: bool,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::delete_release(&repo_path, &tag, cleanup_tag).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket releases aren't supported yet.".into(),
        )),
        _ => github::delete_release(&repo_path, &tag, cleanup_tag).await,
    }
}

/// Upload a file as a release asset, behind the abstraction. GitHub attaches a
/// binary; GitLab uploads to the project and links it as a release asset (its
/// assets are links, so the row renders as a link — no size/download stats).
#[tauri::command]
pub async fn forge_release_upload_asset(
    repo_path: String,
    tag: String,
    file_path: String,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::upload_release_asset(&repo_path, &tag, &file_path).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket releases aren't supported yet.".into(),
        )),
        _ => github::upload_release_asset(&repo_path, &tag, &file_path).await,
    }
}

/// Delete a release asset by its display name, behind the abstraction. GitLab
/// assets are links with server-side ids, so its arm resolves the name to the
/// link id first.
#[tauri::command]
pub async fn forge_release_delete_asset(
    repo_path: String,
    tag: String,
    asset_name: String,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::delete_release_asset(&repo_path, &tag, &asset_name).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket releases aren't supported yet.".into(),
        )),
        _ => github::delete_release_asset(&repo_path, &tag, &asset_name).await,
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

/// Edit an issue's title/body, behind the abstraction — the shared edit dialog.
/// GitHub PATCHes the issue; GitLab PUTs title/description.
#[tauri::command]
pub async fn forge_issue_edit(
    repo_path: String,
    number: u64,
    title: String,
    body: String,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::edit_issue(&repo_path, number, &title, &body).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => github::edit_issue(&repo_path, number, &title, &body).await,
    }
}

/// The repo's open/active milestones for the milestone picker, behind the
/// abstraction. The neutral `Milestone.number` is GitHub's milestone number or
/// GitLab's GLOBAL milestone id — whichever key that provider's write takes.
#[tauri::command]
pub async fn forge_milestones(
    repo_path: String,
) -> AppResult<Vec<crate::github::issue::Milestone>> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::list_milestones(&repo_path).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket milestones aren't supported yet.".into(),
        )),
        _ => github::milestones(&repo_path).await,
    }
}

/// Reactions for an issue + its comments, behind the abstraction. GitLab maps
/// award emoji onto the same shape (comments keyed by note id; GitHub keys them
/// by GraphQL node id — either way the id the thread already carries).
#[tauri::command]
pub async fn forge_issue_reactions(
    repo_path: String,
    number: u64,
) -> AppResult<crate::github::issue::IssueReactions> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::issue_reactions(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => github::issue_reactions(&repo_path, number).await,
    }
}

/// Reactions for a merge/pull request + its comments, behind the abstraction.
#[tauri::command]
pub async fn forge_pr_reactions(
    repo_path: String,
    number: u64,
) -> AppResult<crate::github::issue::IssueReactions> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::mr_reactions(&repo_path, number).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => github::pr_reactions(&repo_path, number).await,
    }
}

/// Add the viewer's reaction, behind the abstraction. The subject is carried in
/// BOTH provider vocabularies (the shared-control different-identifiers rule):
/// GitHub uses `subject_id` (a GraphQL node id — body or comment) and ignores
/// `target`/`number`; GitLab uses `target` (`"issue"`/`"mr"`) + `number`, with
/// `subject_id` empty for the body or the note id for a comment. Discussions
/// (GitHub-only) ride the GitHub arm with `target: "discussion"`.
#[tauri::command]
pub async fn forge_add_reaction(
    repo_path: String,
    target: String,
    number: u64,
    subject_id: String,
    content: String,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            let note_id = (!subject_id.is_empty()).then_some(subject_id.as_str());
            gitlab::add_reaction(&repo_path, &target, number, note_id, &content).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket reactions aren't supported yet.".into(),
        )),
        _ => github::add_reaction(&repo_path, &subject_id, &content).await,
    }
}

/// Remove the viewer's reaction, behind the abstraction (same subject carriage
/// as `forge_add_reaction`; GitLab resolves the award id server-side).
#[tauri::command]
pub async fn forge_remove_reaction(
    repo_path: String,
    target: String,
    number: u64,
    subject_id: String,
    content: String,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            let note_id = (!subject_id.is_empty()).then_some(subject_id.as_str());
            gitlab::remove_reaction(&repo_path, &target, number, note_id, &content).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket reactions aren't supported yet.".into(),
        )),
        _ => github::remove_reaction(&repo_path, &subject_id, &content).await,
    }
}

/// Set (or, with `None`, clear) an issue's milestone, behind the abstraction.
/// `milestone` is whatever `forge_milestones` returned as `number` for the
/// chosen entry.
#[tauri::command]
pub async fn forge_issue_set_milestone(
    repo_path: String,
    number: u64,
    milestone: Option<u64>,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::set_issue_milestone(&repo_path, number, milestone).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => github::set_issue_milestone(&repo_path, number, milestone).await,
    }
}

/// The repo's labels for the label picker, behind the abstraction. GitHub lists them
/// via GraphQL (each with a node id); GitLab lists project labels via `glab` (by name,
/// no id). Used by both the issue and MR label pickers.
#[tauri::command]
pub async fn forge_repo_labels(
    repo_path: String,
) -> AppResult<Vec<crate::github::pr::RepoLabel>> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::repo_labels(&repo_path).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket labels aren't supported yet.".into(),
        )),
        _ => github::repo_labels(&repo_path).await,
    }
}

/// The repo's assignable users for the assignee picker, behind the abstraction.
/// GitHub lists repo assignees; GitLab lists project members (usernames).
#[tauri::command]
pub async fn forge_assignable_users(repo_path: String) -> AppResult<Vec<String>> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::assignable_users(&repo_path).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket assignees aren't supported yet.".into(),
        )),
        _ => github::assignable_users(&repo_path).await,
    }
}

/// Add/remove labels on an issue or merge/pull request, behind the abstraction. A
/// SHARED control: GitHub keys labels by GraphQL node id (`add_ids`/`remove_ids` on
/// the `labelable_id`); GitLab keys them by name (`add_names`/`remove_names` on the
/// numeric `number`). `target` is `"issue"` or `"mr"`. The caller passes both id and
/// name deltas so each provider takes the pair it addresses by.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn forge_edit_labels(
    repo_path: String,
    target: String,
    number: u64,
    labelable_id: String,
    add_ids: Vec<String>,
    remove_ids: Vec<String>,
    add_names: Vec<String>,
    remove_names: Vec<String>,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::edit_labels(&repo_path, &target, number, &add_names, &remove_names).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket labels aren't supported yet.".into(),
        )),
        _ => github::edit_labels(&repo_path, &labelable_id, add_ids, remove_ids).await,
    }
}

/// Set an issue's assignees (the full desired set, by login), behind the abstraction.
/// GitHub PATCHes the issue with the login set; GitLab resolves logins→ids and PUTs
/// `assignee_ids`.
#[tauri::command]
pub async fn forge_issue_set_assignees(
    repo_path: String,
    number: u64,
    assignees: Vec<String>,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::set_issue_assignees(&repo_path, number, &assignees).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket assignees aren't supported yet.".into(),
        )),
        _ => github::set_issue_assignees(&repo_path, number, assignees).await,
    }
}

/// Set a merge request's assignees, behind the abstraction. GitLab-only, like
/// `forge_pr_approvals`: GitHub PRs have no assignee picker in this app (the
/// `mrAssignees` flag stays false there), so the GitHub arm is never reachable
/// from the UI and errors defensively.
#[tauri::command]
pub async fn forge_mr_set_assignees(
    repo_path: String,
    number: u64,
    assignees: Vec<String>,
) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::set_mr_assignees(&repo_path, number, &assignees).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket assignees aren't supported yet.".into(),
        )),
        _ => Err(AppError::InvalidArgument(
            "Pull request assignees aren't editable here for GitHub.".into(),
        )),
    }
}

/// Create an issue, behind the abstraction. Returns the new number + URL.
/// GitHub sends the full field set; GitLab takes everything but the org issue
/// type (no GitLab analogue — the dialog hides that picker, and the dispatch
/// drops it like `forge_issue_close` drops the GitHub-only close reason).
/// `milestone` is whatever `forge_milestones` returned as `number`.
#[tauri::command]
pub async fn forge_issue_create(
    repo_path: String,
    title: String,
    body: String,
    labels: Vec<String>,
    assignees: Vec<String>,
    milestone: Option<u64>,
    issue_type: Option<String>,
) -> AppResult<crate::github::pr::PrRef> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::create_issue(&repo_path, &title, &body, &labels, &assignees, milestone).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket issues aren't supported yet.".into(),
        )),
        _ => {
            github::create_issue(
                &repo_path, &title, &body, labels, assignees, milestone, issue_type,
            )
            .await
        }
    }
}

/// The repo's web URL for "View on GitHub/GitLab", behind the abstraction.
#[tauri::command]
pub async fn forge_repo_url(repo_path: String) -> AppResult<String> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::repo_url(&repo_path).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket repositories aren't supported yet.".into(),
        )),
        _ => github::repo_url(&repo_path).await,
    }
}

/// Whether the signed-in viewer has starred this repo, behind the abstraction.
#[tauri::command]
pub async fn forge_repo_star_status(repo_path: String) -> AppResult<bool> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::repo_star_status(&repo_path).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket repositories aren't supported yet.".into(),
        )),
        _ => github::repo_star_status(&repo_path).await,
    }
}

/// Star / unstar this repo, behind the abstraction.
#[tauri::command]
pub async fn forge_repo_set_star(repo_path: String, starred: bool) -> AppResult<()> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => gitlab::repo_set_star(&repo_path, starred).await,
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket repositories aren't supported yet.".into(),
        )),
        _ => github::repo_set_star(&repo_path, starred).await,
    }
}

/// Which providers this machine can publish a local repo to. A repo with no
/// hosted remote has nothing to detect a provider from, so the publish UI asks
/// explicitly and offers each ready target.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishTargets {
    pub github: bool,
    pub gitlab: bool,
}

#[tauri::command]
pub async fn forge_publish_targets(repo_path: String) -> AppResult<PublishTargets> {
    let gh = crate::github::pr::gh_status(repo_path)
        .await
        .map(|s| s.installed && s.authenticated)
        .unwrap_or(false);
    let gl = gitlab::cli_ready().await;
    Ok(PublishTargets {
        github: gh,
        gitlab: gl,
    })
}

/// Publish a local repo, behind the abstraction. The PROVIDER IS EXPLICIT — a
/// not-yet-published repo has no remote to detect one from. GitHub creates +
/// pushes via `gh repo create --push`; GitLab creates via `glab repo create`,
/// wires `origin`, and pushes with the one-shot credential helper. GitLab has no
/// homepage field (the dialog hides it) and drops it here.
#[tauri::command]
pub async fn forge_publish_repo(
    state: tauri::State<'_, crate::state::AppState>,
    provider: Provider,
    repo_path: String,
    name: String,
    private: bool,
    description: String,
    homepage: String,
    topics: Vec<String>,
) -> AppResult<String> {
    match provider {
        Provider::GitLab => {
            gitlab::publish_repo(&state, &repo_path, &name, private, &description, &topics).await
        }
        Provider::Bitbucket => Err(AppError::InvalidArgument(
            "Bitbucket publishing isn't supported yet.".into(),
        )),
        Provider::GitHub => {
            github::publish_repo(&repo_path, &name, private, &description, &homepage, topics)
                .await
        }
    }
}

/// Create a merge/pull request, behind the abstraction. Both arms push the head
/// branch to origin first (an MR/PR needs it on the remote); GitLab injects glab's
/// token as a one-shot git credential helper for that push, like `forge_clone`.
/// GitHub delegates to the unchanged `gh pr create`; GitLab POSTs the MR with
/// draft mapped to the `Draft:` title prefix. Returns the new number + URL.
#[tauri::command]
pub async fn forge_pr_create(
    state: tauri::State<'_, crate::state::AppState>,
    repo_path: String,
    base: String,
    head: String,
    title: String,
    body: String,
    draft: bool,
) -> AppResult<crate::github::pr::PrRef> {
    match detect_non_github(&repo_path).await {
        Some((Provider::GitLab, _)) => {
            gitlab::create_mr(&state, &repo_path, &base, &head, &title, &body, draft).await
        }
        Some((Provider::Bitbucket, _)) => Err(AppError::InvalidArgument(
            "Bitbucket merge requests aren't supported yet.".into(),
        )),
        _ => crate::github::pr::gh_pr_create(state, repo_path, base, head, title, body, draft)
            .await,
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
