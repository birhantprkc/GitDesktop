//! The GitLab [`Forge`](super::Forge) implementation, via the `glab` CLI.
//!
//! **Phase 1, increment 1 ships STATUS only.** It detects whether `glab` is
//! installed and signed in, but leaves `repo` unset — a GitLab repo therefore
//! reports *not ready*, so every hosted panel keeps showing `ForgeNotReady`
//! (now a `glab` setup ladder) instead of firing GitHub `gh_*` data calls that
//! don't work against GitLab. Read operations (MRs / issues / pipelines) + the
//! `repo` field that flips it to *ready* land in later increments.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::forge::glab::{run_glab, run_glab_raw, GLAB_NETWORK_TIMEOUT, GLAB_TIMEOUT};
use crate::forge::model::{Capabilities, ForgeRepo, ForgeRepoList, ForgeStatus, Provider};
use crate::forge::Forge;

/// GitLab via the `glab` CLI. Carries the repo's host (gitlab.com today; a
/// self-managed host list arrives with the Settings → Accounts work).
pub struct GitLabForge {
    host: String,
}

impl GitLabForge {
    pub fn new(host: String) -> Self {
        Self { host }
    }
}

/// Assemble the neutral status from the `glab` probes. Pure (testable). `repo` is
/// deliberately `None` until read ops exist, keeping a GitLab repo *not ready*.
fn gitlab_status(installed: bool, authenticated: bool, host: &str) -> ForgeStatus {
    ForgeStatus {
        provider: Some(Provider::GitLab),
        installed,
        authenticated,
        repo: None,
        host: Some(host.to_string()),
        login: None,
        capabilities: Capabilities::for_provider(Provider::GitLab),
    }
}

impl Forge for GitLabForge {
    async fn status(&self, repo_path: &str) -> AppResult<ForgeStatus> {
        // glab present on PATH?
        match run_glab_raw(None, &["--version"], GLAB_TIMEOUT).await {
            Err(AppError::GlabNotFound) => {
                return Ok(gitlab_status(false, false, &self.host));
            }
            Err(e) => return Err(e),
            Ok(_) => {}
        }
        // `glab auth status` exits 0 only when signed in on the repo's host;
        // run it in the repo so glab resolves the right (self-managed) host.
        let authenticated = run_glab_raw(Some(repo_path), &["auth", "status"], GLAB_TIMEOUT)
            .await
            .map(|o| o.code == 0)
            .unwrap_or(false);
        Ok(gitlab_status(true, authenticated, &self.host))
    }
}

// ── Repository listing (clone browser) ───────────────────────────────────────

#[derive(Deserialize)]
struct GlabUser {
    username: String,
}

#[derive(Deserialize)]
struct GlabNamespace {
    full_path: String,
}

/// A GitLab project as `glab api projects` returns it (field shape validated live
/// against gitlab.com). Only the fields the clone browser needs are deserialized.
#[derive(Deserialize)]
struct GlabProject {
    name: String,
    path_with_namespace: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    visibility: String,
    #[serde(default)]
    archived: bool,
    http_url_to_repo: String,
    ssh_url_to_repo: String,
    #[serde(default)]
    last_activity_at: Option<String>,
    namespace: GlabNamespace,
    #[serde(default)]
    forked_from_project: Option<serde_json::Value>,
}

fn from_glab_project(p: GlabProject) -> ForgeRepo {
    ForgeRepo {
        full_name: p.path_with_namespace,
        owner: p.namespace.full_path,
        name: p.name,
        // GitLab visibility is public | internal | private; anything but public
        // shows the lock.
        private: p.visibility != "public",
        archived: p.archived,
        fork: p.forked_from_project.is_some(),
        clone_url: p.http_url_to_repo,
        ssh_url: p.ssh_url_to_repo,
        description: p.description,
        pushed_at: p.last_activity_at,
    }
}

/// The signed-in GitLab user's projects, for the clone browser. Uses the `glab
/// api` REST escape hatch (validated live — mirrors `gh api`); `membership=true`
/// = projects the user belongs to. Caps at 100 for now (`--paginate` for >100 is
/// a follow-up — its multi-page output format needs its own validation).
pub async fn list_repos() -> AppResult<ForgeRepoList> {
    let viewer = run_glab(None, &["api", "user"], GLAB_TIMEOUT)
        .await
        .ok()
        .and_then(|o| serde_json::from_str::<GlabUser>(&o.stdout_lossy()).ok())
        .map(|u| u.username)
        .unwrap_or_default();
    let out = run_glab(
        None,
        &["api", "projects?membership=true&per_page=100"],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let projects: Vec<GlabProject> = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse your GitLab projects: {e}")))?;
    Ok(ForgeRepoList {
        viewer,
        repos: projects.into_iter().map(from_glab_project).collect(),
    })
}

/// The `git -c credential.https://<host>.helper=…` entry that lets `git clone` of
/// a private GitLab repo authenticate via glab's token — glab's token isn't in
/// git's credential store, so plain `git clone` (and even `glab repo clone`) 401s.
/// One-shot (per `git` invocation), so nothing is written to git config and no
/// token lands in the remote URL. Validated live against a private gitlab.com repo.
pub async fn clone_credential_config(clone_url: &str) -> AppResult<Vec<String>> {
    let glab = crate::agent::resolve_named(&["glab"], None)
        .await
        .ok_or(AppError::GlabNotFound)?;
    let host = crate::forge::remote_host(clone_url).unwrap_or_else(|| "gitlab.com".to_string());
    Ok(vec![format!(
        "credential.https://{host}.helper=!\"{}\" auth git-credential",
        glab.display()
    )])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detected_gitlab_repo_stays_not_operable_until_read_ops() {
        let s = gitlab_status(true, true, "gitlab.com");
        assert_eq!(s.provider, Some(Provider::GitLab));
        assert_eq!(s.host.as_deref(), Some("gitlab.com"));
        assert!(s.installed && s.authenticated);
        // repo None => forgeReady is false => panels show ForgeNotReady, not gh_* calls.
        assert!(s.repo.is_none());
        // GitLab capability profile (everything but Discussions).
        assert!(!s.capabilities.discussions && s.capabilities.labels);
    }

    #[test]
    fn missing_glab_reports_not_installed() {
        let s = gitlab_status(false, false, "gitlab.com");
        assert_eq!(s.provider, Some(Provider::GitLab));
        assert!(!s.installed && !s.authenticated && s.repo.is_none());
    }

    // Sample JSON below mirrors the real `glab api projects` shape (validated live).
    #[test]
    fn maps_glab_project_to_neutral_repo() {
        let json = r#"{
            "name": "cli",
            "path_with_namespace": "gitlab-org/cli",
            "description": "The GitLab CLI",
            "visibility": "public",
            "archived": false,
            "http_url_to_repo": "https://gitlab.com/gitlab-org/cli.git",
            "ssh_url_to_repo": "git@gitlab.com:gitlab-org/cli.git",
            "last_activity_at": "2026-06-29T22:54:01Z",
            "namespace": { "full_path": "gitlab-org" },
            "forked_from_project": null
        }"#;
        let r = from_glab_project(serde_json::from_str(json).unwrap());
        assert_eq!(r.full_name, "gitlab-org/cli");
        assert_eq!(r.owner, "gitlab-org");
        assert_eq!(r.name, "cli");
        assert!(!r.private && !r.archived && !r.fork);
        assert_eq!(r.clone_url, "https://gitlab.com/gitlab-org/cli.git");
        assert_eq!(r.ssh_url, "git@gitlab.com:gitlab-org/cli.git");
        assert_eq!(r.pushed_at.as_deref(), Some("2026-06-29T22:54:01Z"));
    }

    #[test]
    fn detects_private_and_fork() {
        let json = r#"{
            "name": "x", "path_with_namespace": "me/x",
            "visibility": "private", "archived": true,
            "http_url_to_repo": "h", "ssh_url_to_repo": "s",
            "namespace": { "full_path": "me" },
            "forked_from_project": { "id": 1 }
        }"#;
        let r = from_glab_project(serde_json::from_str(json).unwrap());
        assert!(r.private && r.archived && r.fork);
    }
}
