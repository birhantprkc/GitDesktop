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
pub mod model;

use crate::error::AppResult;
use crate::forge::github::GitHubForge;
use crate::forge::model::{ForgeStatus, Provider};

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
fn remote_host(url: &str) -> Option<String> {
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
        return Ok(ForgeStatus::unimplemented(provider, host));
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
}
