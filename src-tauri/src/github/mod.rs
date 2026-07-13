pub mod actions;
pub mod auth;
pub mod collaborators;
pub mod discussion;
pub mod insights;
pub mod issue;
pub mod lifecycle;
pub mod mcp_search;
pub mod pages;
pub mod pr;
pub mod release;
pub mod repo_settings;
pub mod rulesets;
pub mod runner;
pub mod secrets;
pub mod security;

use crate::error::{AppError, AppResult};

/// The `owner/repo` slug of the checked-out repo's **origin** remote, to pass
/// explicitly as `gh -R <slug>`.
///
/// A bare `gh` call with only the repo path as CWD lets gh auto-resolve the
/// repo. On a fork with an `upstream` remote, that resolution prefers the
/// PARENT — so an unpinned call answers for the upstream repo instead of the
/// user's fork (the Actions surface would show the parent's runs; the fork-badge
/// probe would read the parent's `isFork: false`). Pinning the origin slug keeps
/// every gh call on the fork. For a single-remote repo the slug equals what gh
/// resolved before, so behavior is unchanged there.
///
/// Reuses the cached origin-URL lookup (no extra `git` spawn within its TTL) and
/// the shared origin-path parser, which already strips `.git` and handles both
/// `https://…` and scp-style `git@github.com:owner/repo` URLs. A GitHub origin
/// path is exactly `owner/repo`; the callers can't work without a GitHub origin,
/// so no origin / an unparseable one is a clear error (`AppError::Gh`).
pub(crate) async fn gh_origin_slug(repo_path: &str) -> AppResult<String> {
    let url =
        crate::git::remote::git_remote_url(repo_path.to_string(), "origin".to_string()).await?;
    crate::forge::remote_path(&url).ok_or_else(|| {
        AppError::Gh("could not determine the GitHub repository from the origin remote".into())
    })
}
