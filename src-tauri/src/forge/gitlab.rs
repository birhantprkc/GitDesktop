//! The GitLab [`Forge`](super::Forge) implementation, via the `glab` CLI.
//!
//! **Phase 1, increment 1 ships STATUS only.** It detects whether `glab` is
//! installed and signed in, but leaves `repo` unset — a GitLab repo therefore
//! reports *not ready*, so every hosted panel keeps showing `ForgeNotReady`
//! (now a `glab` setup ladder) instead of firing GitHub `gh_*` data calls that
//! don't work against GitLab. Read operations (MRs / issues / pipelines) + the
//! `repo` field that flips it to *ready* land in later increments.

use std::collections::HashMap;

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::forge::glab::{run_glab, run_glab_raw, GLAB_NETWORK_TIMEOUT, GLAB_TIMEOUT};
use crate::forge::model::{
    Capabilities, ForgeRepo, ForgeRepoList, ForgeStatus, Implemented, Provider,
};
use crate::forge::Forge;
use crate::github::pr::{
    PrAuthor, PrCommitOut, PrDetails, PrFileOut, PrInfo, PrListLabel, PrThreadOut, RepoLabel,
};

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
/// the project path derived from the origin remote, which flips the integration
/// *ready* once `glab` is installed and signed in — merge-request reads are wired
/// up, so it's safe for a GitLab repo to be ready (unbuilt panels degrade to
/// "coming soon" via the `implemented` flags).
fn gitlab_status(
    installed: bool,
    authenticated: bool,
    host: &str,
    repo: Option<String>,
) -> ForgeStatus {
    ForgeStatus {
        provider: Some(Provider::GitLab),
        installed,
        authenticated,
        repo,
        host: Some(host.to_string()),
        login: None,
        capabilities: Capabilities::for_provider(Provider::GitLab),
        implemented: Implemented::for_provider(Provider::GitLab),
    }
}

impl Forge for GitLabForge {
    async fn status(&self, repo_path: &str) -> AppResult<ForgeStatus> {
        // glab present on PATH?
        match run_glab_raw(None, &["--version"], GLAB_TIMEOUT).await {
            Err(AppError::GlabNotFound) => {
                return Ok(gitlab_status(false, false, &self.host, None));
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
        // The project's path (group/name), derived from the origin remote — this is
        // both how we address the glab API and what flips the integration ready.
        let repo = project_path(repo_path).await.ok();
        Ok(gitlab_status(true, authenticated, &self.host, repo))
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

// ── Merge requests (read) ─────────────────────────────────────────────────────
//
// GitLab merge requests map onto the same neutral `PrInfo`/`PrDetails` the GitHub
// panels already render, so the frontend stays provider-agnostic. We go through
// the `glab api` REST escape hatch addressing the project by its URL-encoded full
// path (which GitLab accepts in place of a numeric id), derived from the origin
// remote — the same path `status` reports as `repo`.

/// URL-encode a project's full path for use as a `glab api` project id. Only `/`
/// needs escaping for the paths GitLab allows (letters/digits/`_`/`-`/`.`).
fn encode_project(path: &str) -> String {
    path.replace('/', "%2F")
}

/// The project's full path (`group/name`) from the repo's origin remote.
async fn project_path(repo_path: &str) -> AppResult<String> {
    let url = crate::git::remote::git_remote_url(repo_path.to_string(), "origin".to_string()).await?;
    crate::forge::remote_path(&url).ok_or_else(|| {
        AppError::Glab("could not determine the GitLab project from the origin remote".into())
    })
}

/// Map GitLab's MR state onto the neutral `"OPEN"/"CLOSED"/"MERGED"` the frontend
/// expects (it treats `locked` like closed).
fn map_mr_state(state: &str) -> String {
    match state {
        "opened" => "OPEN".to_string(),
        "merged" => "MERGED".to_string(),
        "closed" | "locked" => "CLOSED".to_string(),
        other => other.to_ascii_uppercase(),
    }
}

/// A GitLab user as embedded in MR/note payloads.
#[derive(Deserialize)]
struct GlabMrUser {
    username: String,
}

/// A merge request as `glab api …/merge_requests` returns it (list shape).
#[derive(Deserialize)]
struct GlabMr {
    iid: u64,
    web_url: String,
    title: String,
    target_branch: String,
    source_branch: String,
    #[serde(default)]
    draft: bool,
    state: String,
    #[serde(default)]
    author: Option<GlabMrUser>,
    #[serde(default)]
    labels: Vec<String>,
}

fn from_glab_mr(m: GlabMr) -> PrInfo {
    PrInfo {
        number: m.iid,
        url: m.web_url,
        title: m.title,
        base_ref_name: m.target_branch,
        head_ref_name: m.source_branch,
        is_draft: m.draft,
        state: map_mr_state(&m.state),
        author: m.author.map(|a| PrAuthor { login: a.username }),
        labels: m
            .labels
            .into_iter()
            .map(|name| PrListLabel { name })
            .collect(),
    }
}

/// The signed-in user's merge requests for this repo. `state` is `"open"` or
/// `"closed"`; the Closed tab shows closed **and** merged (matching the GitHub
/// panel). GitLab splits those into separate server states, so we fetch each on
/// its own `per_page` budget and concatenate — never one `state=all` page where
/// open MRs would dilute (and silently truncate) the closed/merged ones.
pub async fn list_prs(repo_path: &str, state: &str) -> AppResult<Vec<PrInfo>> {
    let enc = encode_project(&project_path(repo_path).await?);
    let states: &[&str] = match state {
        "open" => &["opened"],
        "closed" => &["closed", "merged"],
        other => {
            return Err(AppError::InvalidArgument(format!(
                "unknown PR state filter: {other}"
            )));
        }
    };
    let mut prs = Vec::new();
    for s in states {
        let endpoint = format!("projects/{enc}/merge_requests?state={s}&per_page=100");
        let out = run_glab(Some(repo_path), &["api", &endpoint], GLAB_NETWORK_TIMEOUT).await?;
        let mrs: Vec<GlabMr> = serde_json::from_str(&out.stdout_lossy())
            .map_err(|e| AppError::Glab(format!("could not parse GitLab merge requests: {e}")))?;
        prs.extend(mrs.into_iter().map(from_glab_mr));
    }
    Ok(prs)
}

/// One changed file as the MR `/changes` endpoint returns it.
#[derive(Deserialize)]
struct GlabChange {
    #[serde(default)]
    old_path: String,
    #[serde(default)]
    new_path: String,
    #[serde(default)]
    new_file: bool,
    #[serde(default)]
    deleted_file: bool,
    /// The per-file hunks (no `diff --git`/`---`/`+++` header — we add those).
    #[serde(default)]
    diff: String,
}

/// The MR `/changes` response: the MR's core fields plus its changed files.
#[derive(Deserialize)]
struct GlabMrChanges {
    iid: u64,
    web_url: String,
    title: String,
    #[serde(default)]
    description: Option<String>,
    target_branch: String,
    source_branch: String,
    #[serde(default)]
    draft: bool,
    state: String,
    #[serde(default)]
    author: Option<GlabMrUser>,
    #[serde(default)]
    labels: Vec<String>,
    #[serde(default)]
    changes: Vec<GlabChange>,
}

/// Count added/deleted lines in a GitLab per-file diff. The input is hunk-only
/// (no `---`/`+++` file headers — `reconstruct_file_diff` adds those), so a
/// leading `+`/`-` is always real content; `@@` hunk headers start with `@`.
/// (Don't skip `+++`/`---`-prefixed lines: that would drop genuine content whose
/// text begins with `++`/`--`, e.g. a deleted `---` YAML separator.)
fn count_diff_lines(diff: &str) -> (u32, u32) {
    let mut additions = 0;
    let mut deletions = 0;
    for line in diff.lines() {
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }
    (additions, deletions)
}

/// Rebuild a standard `git`-format file diff from a GitLab change, so the frontend
/// splitter (which keys on `diff --git`/`+++ b/<path>`) parses it like `gh pr diff`.
fn reconstruct_file_diff(c: &GlabChange) -> String {
    let old = if c.old_path.is_empty() {
        &c.new_path
    } else {
        &c.old_path
    };
    let new = if c.new_path.is_empty() {
        &c.old_path
    } else {
        &c.new_path
    };
    let minus = if c.new_file {
        "/dev/null".to_string()
    } else {
        format!("a/{old}")
    };
    let plus = if c.deleted_file {
        "/dev/null".to_string()
    } else {
        format!("b/{new}")
    };
    let mut s = format!("diff --git a/{old} b/{new}\n--- {minus}\n+++ {plus}\n");
    s.push_str(&c.diff);
    if !c.diff.ends_with('\n') {
        s.push('\n');
    }
    s
}

#[derive(Deserialize)]
struct GlabCommit {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    author_name: String,
    #[serde(default)]
    created_at: String,
}

#[derive(Deserialize)]
struct GlabNote {
    id: u64,
    #[serde(default)]
    system: bool,
    #[serde(default)]
    body: String,
    #[serde(default)]
    author: Option<GlabMrUser>,
    #[serde(default)]
    created_at: String,
}

#[derive(Deserialize)]
struct GlabLabel {
    name: String,
    #[serde(default)]
    color: String,
}

/// A name→hex-color map of the project's labels (color without the leading `#`,
/// as the frontend's `RepoLabel` expects). Best-effort: empty on any failure.
async fn project_label_colors(repo_path: &str, enc: &str) -> HashMap<String, String> {
    run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/labels?per_page=100")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await
    .ok()
    .and_then(|o| serde_json::from_str::<Vec<GlabLabel>>(&o.stdout_lossy()).ok())
    .map(|labels| {
        labels
            .into_iter()
            .map(|l| (l.name, l.color.trim_start_matches('#').to_string()))
            .collect()
    })
    .unwrap_or_default()
}

/// Full read view of one merge request — core fields + files, commits, and
/// comments, mapped onto `PrDetails`. Reviews and CI checks are left empty for now
/// (GitLab approvals/pipelines arrive with later increments).
pub async fn view_pr(repo_path: &str, number: u64) -> AppResult<PrDetails> {
    let enc = encode_project(&project_path(repo_path).await?);

    // Core fields + changed files in one call.
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/merge_requests/{number}/changes")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let mr: GlabMrChanges = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab merge request: {e}")))?;

    let mut additions = 0;
    let mut deletions = 0;
    let files: Vec<PrFileOut> = mr
        .changes
        .iter()
        .map(|c| {
            let (a, d) = count_diff_lines(&c.diff);
            additions += a;
            deletions += d;
            PrFileOut {
                path: if c.new_path.is_empty() {
                    c.old_path.clone()
                } else {
                    c.new_path.clone()
                },
                additions: a,
                deletions: d,
            }
        })
        .collect();

    // Commits — GitLab returns newest-first; the frontend treats the last as head,
    // so reverse to oldest-first (matching gh's GraphQL order).
    let mut commits: Vec<PrCommitOut> = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/merge_requests/{number}/commits?per_page=100")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await
    .ok()
    .and_then(|o| serde_json::from_str::<Vec<GlabCommit>>(&o.stdout_lossy()).ok())
    .unwrap_or_default()
    .into_iter()
    .map(|c| PrCommitOut {
        oid: c.id,
        headline: c.title,
        date: c.created_at,
        author: c.author_name,
    })
    .collect();
    commits.reverse();

    // Comments — drop GitLab's system notes (auto "added a commit", etc.).
    let comments: Vec<PrThreadOut> = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/merge_requests/{number}/notes?sort=asc&per_page=100")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await
    .ok()
    .and_then(|o| serde_json::from_str::<Vec<GlabNote>>(&o.stdout_lossy()).ok())
    .unwrap_or_default()
    .into_iter()
    .filter(|n| !n.system)
    .map(|n| PrThreadOut {
        author: n.author.map(|a| a.username).unwrap_or_default(),
        state: String::new(),
        body: n.body,
        date: n.created_at,
        id: n.id.to_string(),
        url: String::new(),
        viewer_did_author: false,
        is_minimized: false,
        minimized_reason: String::new(),
    })
    .collect();

    let colors = project_label_colors(repo_path, &enc).await;
    let labels: Vec<RepoLabel> = mr
        .labels
        .into_iter()
        .map(|name| {
            let color = colors.get(&name).cloned().unwrap_or_default();
            RepoLabel {
                id: String::new(),
                name,
                color,
            }
        })
        .collect();

    Ok(PrDetails {
        // No GraphQL node id on GitLab; label/reaction mutations are GitHub-only and
        // hidden for GitLab, so an empty id is fine.
        id: String::new(),
        number: mr.iid,
        title: mr.title,
        body: mr.description.unwrap_or_default(),
        author: mr.author.map(|a| a.username).unwrap_or_default(),
        state: map_mr_state(&mr.state),
        is_draft: mr.draft,
        base_ref_name: mr.target_branch,
        head_ref_name: mr.source_branch,
        additions,
        deletions,
        url: mr.web_url,
        commits,
        files,
        reviews: Vec::new(),
        comments,
        checks: Vec::new(),
        labels,
    })
}

/// The unified diff for one merge request, rebuilt from `/changes` into the same
/// `git`-style format `gh pr diff` produces so the frontend diff viewer parses it.
pub async fn diff_pr(repo_path: &str, number: u64) -> AppResult<String> {
    let enc = encode_project(&project_path(repo_path).await?);
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/merge_requests/{number}/changes")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let mr: GlabMrChanges = serde_json::from_str(&out.stdout_lossy()).map_err(|e| {
        AppError::Glab(format!("could not parse GitLab merge request changes: {e}"))
    })?;
    let mut diff = String::new();
    for c in &mr.changes {
        diff.push_str(&reconstruct_file_diff(c));
    }
    // Cap to match the GitHub path (`gh_pr_diff`), so a pathologically large MR
    // can't blow up the diff viewer.
    let (text, _) = crate::git::diff::truncate_at_char_boundary(diff, 2_000_000);
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_gitlab_repo_has_repo_and_merge_request_support() {
        let s = gitlab_status(true, true, "gitlab.com", Some("group/repo".into()));
        assert_eq!(s.provider, Some(Provider::GitLab));
        assert_eq!(s.host.as_deref(), Some("gitlab.com"));
        assert!(s.installed && s.authenticated);
        // repo Some => forgeReady is true; MR reads are implemented…
        assert_eq!(s.repo.as_deref(), Some("group/repo"));
        assert!(s.implemented.pull_requests);
        // …but issues/CI still degrade to "coming soon".
        assert!(!s.implemented.issues && !s.implemented.ci);
        // GitLab capability profile (everything but Discussions).
        assert!(!s.capabilities.discussions && s.capabilities.labels);
    }

    #[test]
    fn missing_glab_reports_not_installed() {
        let s = gitlab_status(false, false, "gitlab.com", None);
        assert_eq!(s.provider, Some(Provider::GitLab));
        assert!(!s.installed && !s.authenticated && s.repo.is_none());
    }

    #[test]
    fn maps_glab_mr_to_neutral_pr() {
        let json = r#"{
            "iid": 7,
            "web_url": "https://gitlab.com/g/r/-/merge_requests/7",
            "title": "Add dark mode",
            "target_branch": "main",
            "source_branch": "feature/dark",
            "draft": false,
            "state": "merged",
            "author": { "username": "alice" },
            "labels": ["enhancement", "ui"]
        }"#;
        let p = from_glab_mr(serde_json::from_str(json).unwrap());
        assert_eq!(p.number, 7);
        assert_eq!(p.base_ref_name, "main");
        assert_eq!(p.head_ref_name, "feature/dark");
        assert_eq!(p.state, "MERGED");
        assert_eq!(p.author.unwrap().login, "alice");
        assert_eq!(p.labels.len(), 2);
    }

    #[test]
    fn mr_state_maps_to_neutral() {
        assert_eq!(map_mr_state("opened"), "OPEN");
        assert_eq!(map_mr_state("closed"), "CLOSED");
        assert_eq!(map_mr_state("locked"), "CLOSED");
        assert_eq!(map_mr_state("merged"), "MERGED");
    }

    #[test]
    fn counts_added_and_deleted_lines() {
        let diff = "@@ -1,2 +1,3 @@\n context\n-old\n+new\n+extra\n";
        assert_eq!(count_diff_lines(diff), (2, 1));
    }

    #[test]
    fn counts_content_lines_that_start_with_plus_or_minus_runs() {
        // Hunk-only input: an added line whose content is `++x` and a deleted
        // `---` separator are real content, not file headers — both must count.
        let diff = "@@ -1,2 +1,2 @@\n+++added\n---\n context\n";
        assert_eq!(count_diff_lines(diff), (1, 1));
    }

    #[test]
    fn reconstructs_new_file_diff_with_git_header() {
        let c = GlabChange {
            old_path: "docs/x.md".into(),
            new_path: "docs/x.md".into(),
            new_file: true,
            deleted_file: false,
            diff: "@@ -0,0 +1 @@\n+hi".into(),
        };
        let out = reconstruct_file_diff(&c);
        // The splitter keys on these lines, so they must be present and well-formed.
        assert!(out.starts_with("diff --git a/docs/x.md b/docs/x.md\n"));
        assert!(out.contains("--- /dev/null\n"));
        assert!(out.contains("+++ b/docs/x.md\n"));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn reconstructs_deleted_file_diff() {
        let c = GlabChange {
            old_path: "gone.txt".into(),
            new_path: "gone.txt".into(),
            new_file: false,
            deleted_file: true,
            diff: "@@ -1 +0,0 @@\n-bye\n".into(),
        };
        let out = reconstruct_file_diff(&c);
        assert!(out.contains("--- a/gone.txt\n"));
        assert!(out.contains("+++ /dev/null\n"));
    }

    #[test]
    fn encodes_nested_project_path() {
        assert_eq!(encode_project("group/sub/repo"), "group%2Fsub%2Frepo");
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
