//! The GitLab [`Forge`](super::Forge) implementation, via the `glab` CLI.
//!
//! Every operation maps GitLab's JSON onto the SAME neutral models the GitHub
//! panels already render (`PrInfo`, `IssueDetails`, `WorkflowRun`, `ReleaseInfo`,
//! …), so the frontend stays provider-agnostic. Reads cover MRs, issues, CI
//! pipelines, and releases; writes land per-action behind `Implemented` flags
//! (comment, close/reopen, approve, merge, labels, assignees, create, pipeline
//! retry/cancel/run, release management). Which features are wired up is declared
//! in `model.rs::Implemented::for_provider` — flip flags there as impls land.

use std::collections::HashMap;

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::forge::glab::{run_glab, run_glab_raw, GLAB_NETWORK_TIMEOUT, GLAB_TIMEOUT};
use crate::forge::model::{
    Capabilities, ForgeRepo, ForgeRepoList, ForgeStatus, Implemented, Provider,
};
use crate::forge::Forge;
use crate::github::actions::{RunDetail, RunJob, WorkflowRun};
use crate::github::issue::{IssueDetails, IssueInfo, Milestone};
use crate::github::pr::{
    ApprovalState, PrAuthor, PrCommitOut, PrDetails, PrFileOut, PrInfo, PrListLabel, PrRef,
    PrThreadOut, RepoLabel,
};
use crate::state::AppState;
use crate::github::release::{ReleaseAsset, ReleaseDetails, ReleaseInfo};

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

/// Percent-encode a value for safe use inside a `glab api` query string. `glab`
/// forwards the endpoint verbatim (it only encodes the path, not query values), so
/// a value with a query-significant byte (`&`, `#`, `?`, `=`, `%`, space, …) must be
/// encoded or it corrupts the query. Encodes everything outside RFC-3986 unreserved.
fn encode_query_value(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
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

/// Deserialize a field the provider may send as JSON `null` rather than omitting,
/// treating a present `null` as the type's default. Paired with `#[serde(default)]`
/// (which only fills a *missing* key) this absorbs both — the exact trap that sank a
/// whole issue parse when GitLab returned `discussion_locked: null` instead of
/// `false`. Applied to the optional scalars and the collections GitLab could null
/// out (it returns `[]` today, but the same one-quirk-away fragility bit us once).
fn null_to_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
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
    #[serde(default, deserialize_with = "null_to_default")]
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
    #[serde(default, deserialize_with = "null_to_default")]
    assignees: Vec<GlabMrUser>,
    #[serde(default, deserialize_with = "null_to_default")]
    labels: Vec<String>,
    #[serde(default, deserialize_with = "null_to_default")]
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
        // No GraphQL node id on GitLab; the GitLab mutations key on the iid (labels
        // by name, assignees by resolved numeric id), so an empty id is fine.
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
        assignees: mr.assignees.into_iter().map(|a| a.username).collect(),
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

// ── Merge requests (write) ────────────────────────────────────────────────────
//
// Comment (note), close/reopen, approve/unapprove, and merge — mirroring the
// gh_pr_* commands and dispatching through forge_pr_*. (Full reviews and MR body
// editing stay GitHub-only.) Same glab `-f` raw-field + `state_event` shape as the
// issue writes (validated live against the demo). Unlike issue close, MR close has
// no reason on either platform.

/// Post a comment (note) on a merge request.
pub async fn comment_mr(repo_path: &str, number: u64, body: &str) -> AppResult<()> {
    if body.trim().is_empty() {
        return Err(AppError::InvalidArgument("a comment is required".into()));
    }
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/merge_requests/{number}/notes");
    let body_arg = format!("body={body}");
    run_glab(
        Some(repo_path),
        &["api", "--method", "POST", &endpoint, "-f", &body_arg],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Close or reopen a merge request via the `state_event` field (`close` / `reopen`).
async fn set_mr_state(repo_path: &str, number: u64, event: &str) -> AppResult<()> {
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/merge_requests/{number}");
    let state_arg = format!("state_event={event}");
    run_glab(
        Some(repo_path),
        &["api", "--method", "PUT", &endpoint, "-f", &state_arg],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

pub async fn close_mr(repo_path: &str, number: u64) -> AppResult<()> {
    set_mr_state(repo_path, number, "close").await
}

pub async fn reopen_mr(repo_path: &str, number: u64) -> AppResult<()> {
    set_mr_state(repo_path, number, "reopen").await
}

// ── Merge requests (approvals) ────────────────────────────────────────────────
//
// GitLab's approve/unapprove is a bodyless toggle with no GitHub analogue (GitHub
// approves through the review flow), so it surfaces as a GitLab-only control gated
// on `implemented.mr_approve`. The approvals read drives the toggle. `user_can_approve`
// is deliberately dropped from the neutral shape: GitLab reports it `false` on the
// Free tier even when approving succeeds (it's a Premium approval-rules signal), so
// the toggle keys on `user_has_approved` instead and a real permission error surfaces
// via the action's toast. Validated live against the demo (approve adds the viewer to
// `approved_by`; unapprove reverts it).

/// One entry of a GitLab MR's `approved_by` list.
#[derive(Deserialize)]
struct GlabApprovedBy {
    #[serde(default)]
    user: Option<GlabMrUser>,
}

/// The MR `/approvals` response (the fields we map onto `ApprovalState`).
#[derive(Deserialize)]
struct GlabApprovals {
    #[serde(default)]
    user_has_approved: bool,
    #[serde(default, deserialize_with = "null_to_default")]
    approved_by: Vec<GlabApprovedBy>,
    #[serde(default)]
    approvals_required: u32,
    #[serde(default)]
    approvals_left: u32,
}

/// The viewer's + the MR's approval state, mapped onto the neutral `ApprovalState`.
pub async fn pr_approvals(repo_path: &str, number: u64) -> AppResult<ApprovalState> {
    let enc = encode_project(&project_path(repo_path).await?);
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/merge_requests/{number}/approvals")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let a: GlabApprovals = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab approvals: {e}")))?;
    Ok(ApprovalState {
        viewer_has_approved: a.user_has_approved,
        approved_by: a
            .approved_by
            .into_iter()
            .filter_map(|x| x.user.map(|u| u.username))
            .collect(),
        approvals_required: a.approvals_required,
        approvals_left: a.approvals_left,
    })
}

/// Approve a merge request as the signed-in user (bodyless POST).
pub async fn approve_pr(repo_path: &str, number: u64) -> AppResult<()> {
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/merge_requests/{number}/approve");
    run_glab(
        Some(repo_path),
        &["api", "--method", "POST", &endpoint],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Revoke the signed-in user's approval of a merge request.
pub async fn unapprove_pr(repo_path: &str, number: u64) -> AppResult<()> {
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/merge_requests/{number}/unapprove");
    run_glab(
        Some(repo_path),
        &["api", "--method", "POST", &endpoint],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

// ── Merge requests (merge) ────────────────────────────────────────────────────
//
// MR merge — a SHARED control with GitHub's `gh pr merge`. GitLab's merge endpoint
// controls `squash` (the one genuine per-MR knob) + `should_remove_source_branch`; the
// merge-commit-vs-fast-forward shape is the PROJECT's `merge_method` setting, NOT a
// per-MR choice. So we offer only `merge` (squash=false) and `squash` (squash=true) and
// reject `rebase` (GitLab has no per-MR rebase-merge — that's the project setting plus a
// separate async endpoint, deliberately out of scope). The optional `sha` guards against
// merging a head the user never saw (GitLab 409s if it moved). Validated live against the
// demo: squash+delete+sha happy path, sha-mismatch 409, and 405 on an unmergeable MR — all
// exit non-zero carrying a message, so they surface via the existing toast.

/// Merge a merge request. `strategy` is `merge` (merge commit) or `squash`; `rebase` is
/// rejected (GitLab merges via the project's configured method). `sha`, when non-empty,
/// must match the source branch HEAD or GitLab refuses — a stale-view safety guard.
pub async fn merge_mr(
    repo_path: &str,
    number: u64,
    strategy: &str,
    delete_branch: bool,
    sha: Option<&str>,
) -> AppResult<()> {
    let squash = match strategy {
        "merge" => false,
        "squash" => true,
        other => {
            return Err(AppError::InvalidArgument(format!(
                "GitLab merges via the project's configured method; '{other}' isn't a per-MR option"
            )));
        }
    };
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/merge_requests/{number}/merge");
    let squash_arg = format!("squash={squash}");
    let remove_arg = format!("should_remove_source_branch={delete_branch}");
    let mut args = vec![
        "api", "--method", "PUT", &endpoint, "-f", &squash_arg, "-f", &remove_arg,
    ];
    // Only guard on a non-empty SHA — an empty `sha=` would itself be rejected.
    let sha_arg;
    if let Some(s) = sha.filter(|s| !s.is_empty()) {
        sha_arg = format!("sha={s}");
        args.push("-f");
        args.push(&sha_arg);
    }
    run_glab(Some(repo_path), &args, GLAB_NETWORK_TIMEOUT).await?;
    Ok(())
}

// ── Issues (read) ─────────────────────────────────────────────────────────────
//
// GitLab issues map onto the same neutral `IssueInfo`/`IssueDetails` the GitHub
// panels render, so the frontend stays provider-agnostic. As with MRs we go
// through `glab api` addressing the project by its URL-encoded full path. Only
// reads are wired up; every issue *mutation* (comment/close/label/assign/…) stays
// GitHub-only and is hidden for GitLab on the frontend, so the GitLab fields the
// mutations would need (node id, lock reason, pinned, org issue type) are left
// empty rather than mislabeled.

/// Map GitLab's issue state (`opened`/`closed`) onto the neutral `"OPEN"/"CLOSED"`
/// the frontend expects. (Issues, unlike MRs, never have a `merged` state.)
fn map_issue_state(state: &str) -> String {
    match state {
        "opened" => "OPEN".to_string(),
        "closed" => "CLOSED".to_string(),
        other => other.to_ascii_uppercase(),
    }
}

/// An issue as `glab api …/issues` returns it (list shape).
#[derive(Deserialize)]
struct GlabIssue {
    iid: u64,
    web_url: String,
    title: String,
    state: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    author: Option<GlabMrUser>,
    #[serde(default, deserialize_with = "null_to_default")]
    labels: Vec<String>,
}

fn from_glab_issue(i: GlabIssue) -> IssueInfo {
    IssueInfo {
        number: i.iid,
        url: i.web_url,
        title: i.title,
        state: map_issue_state(&i.state),
        created_at: i.created_at,
        updated_at: i.updated_at,
        author: i.author.map(|a| PrAuthor { login: a.username }),
        labels: i
            .labels
            .into_iter()
            .map(|name| PrListLabel { name })
            .collect(),
    }
}

/// A GitLab milestone as embedded in an issue payload (its `iid` is the per-project
/// number, mirroring how `Milestone.number` is used on GitHub).
#[derive(Deserialize)]
struct GlabMilestone {
    iid: u64,
    title: String,
}

/// One issue as `glab api …/issues/{iid}` returns it (detail shape). GitLab's body
/// is `description`; `assignees`/`milestone` carry the sidebar metadata.
#[derive(Deserialize)]
struct GlabIssueDetail {
    iid: u64,
    web_url: String,
    title: String,
    #[serde(default)]
    description: Option<String>,
    state: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    author: Option<GlabMrUser>,
    #[serde(default, deserialize_with = "null_to_default")]
    labels: Vec<String>,
    #[serde(default, deserialize_with = "null_to_default")]
    assignees: Vec<GlabMrUser>,
    #[serde(default)]
    milestone: Option<GlabMilestone>,
    // GitLab returns `null` (not `false`) when the discussion isn't locked, and
    // `#[serde(default)]` only fills a MISSING key — a present `null` would fail to
    // deserialize into a bare `bool` and sink the whole detail parse ("Could not
    // load this issue"). `null_to_default` absorbs both null and missing.
    #[serde(default, deserialize_with = "null_to_default")]
    discussion_locked: bool,
}

/// The repo's issues for the Issues list. `state` is `"open"` or `"closed"`.
/// GitLab issue state is a single `opened`/`closed` axis (no `merged`), so unlike
/// `list_prs` this is one fetch. GitLab's `/issues` endpoint already excludes merge
/// requests, so no extra filtering is needed.
pub async fn list_issues(repo_path: &str, state: &str) -> AppResult<Vec<IssueInfo>> {
    let enc = encode_project(&project_path(repo_path).await?);
    let gl_state = match state {
        "open" => "opened",
        "closed" => "closed",
        other => {
            return Err(AppError::InvalidArgument(format!(
                "unknown issue state filter: {other}"
            )));
        }
    };
    let endpoint = format!("projects/{enc}/issues?state={gl_state}&per_page=100");
    let out = run_glab(Some(repo_path), &["api", &endpoint], GLAB_NETWORK_TIMEOUT).await?;
    let issues: Vec<GlabIssue> = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab issues: {e}")))?;
    Ok(issues.into_iter().map(from_glab_issue).collect())
}

/// Full read view of one issue — core fields, labels (with colors), and comments,
/// mapped onto `IssueDetails`. GitHub-only sidebar fields (org issue type, pinned)
/// are left empty; issues have no diff so there's no `diff` counterpart.
pub async fn view_issue(repo_path: &str, number: u64) -> AppResult<IssueDetails> {
    let enc = encode_project(&project_path(repo_path).await?);

    // Core issue fields.
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/issues/{number}")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let issue: GlabIssueDetail = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab issue: {e}")))?;

    // Comments — drop GitLab's system notes (auto "changed the milestone", etc.).
    let comments: Vec<PrThreadOut> = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/issues/{number}/notes?sort=asc&per_page=100")],
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
    let labels: Vec<RepoLabel> = issue
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

    Ok(IssueDetails {
        // No GraphQL node id on GitLab; the GitLab mutations key on the iid (labels
        // by name), and reaction/sub-issue mutations stay GitHub-only — so an empty
        // id is fine.
        id: String::new(),
        number: issue.iid,
        title: issue.title,
        body: issue.description.unwrap_or_default(),
        author: issue.author.map(|a| a.username).unwrap_or_default(),
        state: map_issue_state(&issue.state),
        created_at: issue.created_at,
        url: issue.web_url,
        assignees: issue.assignees.into_iter().map(|a| a.username).collect(),
        // The read-only rail shows only the title; `number` is display-only here
        // (milestone mutations are GitHub-only). GitLab's `iid` is project-scoped
        // for project milestones but group-scoped for group milestones — fine while
        // unused, but revisit before making the milestone actionable for GitLab.
        milestone: issue.milestone.map(|m| Milestone {
            number: m.iid,
            title: m.title,
        }),
        // GitLab's issue "type" (issue/incident/task) isn't GitHub's org-defined
        // issue type, and GitLab has no pinned-issue concept here — leave both unset
        // rather than mislabel.
        issue_type: None,
        is_pinned: false,
        locked: issue.discussion_locked,
        active_lock_reason: None,
        comments,
        labels,
    })
}

// ── Issues (write) ────────────────────────────────────────────────────────────
//
// The first GitLab WRITE actions: post a comment (note) and close/reopen. They
// mirror gh_issue_comment/close/reopen and dispatch through forge_issue_*; the
// frontend un-gates just these for GitLab (every other issue write stays GitHub-
// only). The GitHub close `reason` (completed/not_planned) has no GitLab analogue,
// so the dispatch drops it before calling close_issue. `glab api -f key=value` is a
// RAW string field (no `@file` interpretation, unlike `-F`), so a body starting
// with `@` or carrying newlines is safe (glab is a real .exe — no BatBadBut shim
// refusal of newline argv; both validated live against the demo).

/// Post a comment (note) on an issue.
pub async fn comment_issue(repo_path: &str, number: u64, body: &str) -> AppResult<()> {
    if body.trim().is_empty() {
        return Err(AppError::InvalidArgument("a comment is required".into()));
    }
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/issues/{number}/notes");
    let body_arg = format!("body={body}");
    run_glab(
        Some(repo_path),
        &["api", "--method", "POST", &endpoint, "-f", &body_arg],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Close or reopen an issue via the `state_event` field (`close` / `reopen`).
async fn set_issue_state(repo_path: &str, number: u64, event: &str) -> AppResult<()> {
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/issues/{number}");
    let state_arg = format!("state_event={event}");
    run_glab(
        Some(repo_path),
        &["api", "--method", "PUT", &endpoint, "-f", &state_arg],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

pub async fn close_issue(repo_path: &str, number: u64) -> AppResult<()> {
    set_issue_state(repo_path, number, "close").await
}

pub async fn reopen_issue(repo_path: &str, number: u64) -> AppResult<()> {
    set_issue_state(repo_path, number, "reopen").await
}

// ── Labels & assignees (read + write) ─────────────────────────────────────────
//
// Labels are a SHARED control on both issues and MRs (GitHub keys them by GraphQL
// node id, GitLab by name); issue assignees are a shared issue control. The pickers
// read the project's labels / members, then the writes apply a delta (labels) or a
// full set (assignees). Both arg forms were validated live against the demo:
//   • labels  → `add_labels=<csv>` / `remove_labels=<csv>` (delta, by name);
//   • assignees → `assignee_ids=<comma-joined ids>` (set) or `=0` (clear). GitLab
//     assigns by numeric id, so the write resolves usernames→ids from the members
//     list. The `assignee_ids[]=…` array form 400s through glab's `-f`, hence the
//     comma form; on the Free tier GitLab keeps only the first id (reconciled by
//     refetch). The same PUT works on MRs (GitLab-only — GitHub PRs have no picker).

/// The project's labels for the label picker, as neutral `RepoLabel`s. GitLab has no
/// node id for a label (it addresses them by name), so `id` is left empty — the
/// frontend's GitLab path keys the write on the name instead.
pub async fn repo_labels(repo_path: &str) -> AppResult<Vec<RepoLabel>> {
    let enc = encode_project(&project_path(repo_path).await?);
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/labels?per_page=100")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let labels: Vec<GlabLabel> = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab labels: {e}")))?;
    Ok(labels
        .into_iter()
        .map(|l| RepoLabel {
            id: String::new(),
            name: l.name,
            color: l.color.trim_start_matches('#').to_string(),
        })
        .collect())
}

/// A GitLab project member (assignee candidate). `id` is required to SET assignees —
/// GitLab assigns by numeric id, not username, so the write resolves usernames→ids.
#[derive(Deserialize)]
struct GlabMember {
    id: u64,
    username: String,
}

/// The project's members (`members/all` = direct + inherited group members).
async fn project_members(repo_path: &str) -> AppResult<Vec<GlabMember>> {
    let enc = encode_project(&project_path(repo_path).await?);
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/members/all?per_page=100")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab project members: {e}")))
}

/// Resolve assignee usernames to GitLab's numeric ids via the project members.
/// Errors when the members can't be fetched (a 403/timeout must not read as "no
/// match") or when ANY username fails to resolve (naming the misses) — an assignee
/// write must never silently drop someone (fail safe; shared by the set + create
/// paths). A miss is a picker-vs-submit race or a >100-member project (the members
/// read is capped at one page).
async fn resolve_assignee_ids(repo_path: &str, assignees: &[String]) -> AppResult<Vec<u64>> {
    let members = project_members(repo_path).await?;
    let by_name: HashMap<&str, u64> =
        members.iter().map(|m| (m.username.as_str(), m.id)).collect();
    let mut ids = Vec::with_capacity(assignees.len());
    let mut missing: Vec<&str> = Vec::new();
    for u in assignees {
        match by_name.get(u.as_str()) {
            Some(id) => ids.push(*id),
            None => missing.push(u.as_str()),
        }
    }
    if !missing.is_empty() {
        return Err(AppError::Glab(format!(
            "could not match {} to GitLab project members",
            missing.join(", ")
        )));
    }
    Ok(ids)
}

/// The project's assignable users, as usernames (mirroring `gh_assignable_users`).
/// `members/all` can list a user twice (direct + inherited), so dedupe by username.
pub async fn assignable_users(repo_path: &str) -> AppResult<Vec<String>> {
    let mut seen = std::collections::HashSet::new();
    Ok(project_members(repo_path)
        .await?
        .into_iter()
        .filter(|m| seen.insert(m.username.clone()))
        .map(|m| m.username)
        .collect())
}

/// Add/remove labels on an issue or MR by NAME (GitLab's `add_labels`/`remove_labels`
/// delta fields). `target` is `"issue"` or `"mr"`. An empty add+remove is a no-op.
pub async fn edit_labels(
    repo_path: &str,
    target: &str,
    number: u64,
    add: &[String],
    remove: &[String],
) -> AppResult<()> {
    if add.is_empty() && remove.is_empty() {
        return Ok(());
    }
    let path = match target {
        "issue" => "issues",
        "mr" => "merge_requests",
        other => {
            return Err(AppError::InvalidArgument(format!(
                "unknown label target: {other}"
            )));
        }
    };
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/{path}/{number}");
    let add_arg = format!("add_labels={}", add.join(","));
    let remove_arg = format!("remove_labels={}", remove.join(","));
    let mut args = vec!["api", "--method", "PUT", &endpoint];
    if !add.is_empty() {
        args.push("-f");
        args.push(&add_arg);
    }
    if !remove.is_empty() {
        args.push("-f");
        args.push(&remove_arg);
    }
    run_glab(Some(repo_path), &args, GLAB_NETWORK_TIMEOUT).await?;
    Ok(())
}

/// Set an issue's or MR's assignees to the desired set of usernames — the two
/// endpoints differ only in the path segment. GitLab assigns by numeric id, so
/// resolve usernames→ids from the project members; an empty list clears all
/// assignees (`assignee_ids=0`). A non-empty request that resolves to no known
/// member errors rather than silently clearing.
async fn set_target_assignees(
    repo_path: &str,
    target_segment: &str,
    number: u64,
    assignees: &[String],
) -> AppResult<()> {
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/{target_segment}/{number}");
    // A resolution miss errors inside the resolver — it must never turn an assign
    // into a partial assign or (worse) a clear.
    let ids: Vec<u64> = if assignees.is_empty() {
        Vec::new()
    } else {
        resolve_assignee_ids(repo_path, assignees).await?
    };
    // `assignee_ids=0` clears; otherwise the comma-joined id list (the `[]` array
    // form 400s through glab's `-f`).
    let value = if ids.is_empty() {
        "0".to_string()
    } else {
        ids.iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",")
    };
    let arg = format!("assignee_ids={value}");
    run_glab(
        Some(repo_path),
        &["api", "--method", "PUT", &endpoint, "-f", &arg],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Set an issue's assignees (usernames; empty clears).
pub async fn set_issue_assignees(
    repo_path: &str,
    number: u64,
    assignees: &[String],
) -> AppResult<()> {
    set_target_assignees(repo_path, "issues", number, assignees).await
}

/// Set a merge request's assignees (usernames; empty clears). GitLab-only — GitHub
/// PRs have no assignee picker in this app.
pub async fn set_mr_assignees(
    repo_path: &str,
    number: u64,
    assignees: &[String],
) -> AppResult<()> {
    set_target_assignees(repo_path, "merge_requests", number, assignees).await
}

// ── Issues & merge requests (create) ──────────────────────────────────────────
//
// Both creates POST through `glab api` and return the same neutral `PrRef`
// (number + URL) the GitHub creates return, so the dialogs stay provider-agnostic.
// Arg forms validated live against the demo: `labels=<csv>` (names) and
// `assignee_ids=<csv>` (numeric ids, resolved from usernames like the assignee
// write) on issue create; `source_branch`/`target_branch`/`title`/`description`
// on MR create, with **draft = the `Draft:` title prefix** (GitLab has no draft
// field on create — the response then carries `draft: true`). Note the created
// issue's `web_url` comes back in GitLab's newer `/-/work_items/<iid>` form.

/// The created issue/MR fields we need back (GitLab returns the full object).
#[derive(Deserialize)]
struct GlabCreated {
    iid: u64,
    web_url: String,
}

/// Create an issue with optional labels (by name) and assignees (by username —
/// resolved to GitLab's numeric ids via the project members, erroring rather than
/// silently dropping when none resolve). Milestone / org issue type aren't wired
/// for GitLab (the dialog hides those pickers).
pub async fn create_issue(
    repo_path: &str,
    title: &str,
    body: &str,
    labels: &[String],
    assignees: &[String],
) -> AppResult<PrRef> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidArgument(
            "an issue title is required".into(),
        ));
    }
    let labels_arg = (!labels.is_empty()).then(|| format!("labels={}", labels.join(",")));
    let mut ids_arg = None;
    if !assignees.is_empty() {
        // Full resolution or error — never create with a silently-reduced set.
        let ids = resolve_assignee_ids(repo_path, assignees).await?;
        ids_arg = Some(format!(
            "assignee_ids={}",
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        ));
    }
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/issues");
    let title_arg = format!("title={title}");
    let desc_arg = format!("description={body}");
    let mut args = vec![
        "api", "--method", "POST", &endpoint, "-f", &title_arg, "-f", &desc_arg,
    ];
    if let Some(a) = &labels_arg {
        args.push("-f");
        args.push(a);
    }
    if let Some(a) = &ids_arg {
        args.push("-f");
        args.push(a);
    }
    let out = run_glab(Some(repo_path), &args, GLAB_NETWORK_TIMEOUT).await?;
    let created: GlabCreated = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse the created issue: {e}")))?;
    Ok(PrRef {
        number: created.iid,
        url: created.web_url,
    })
}

/// Push `head` to origin, then open a merge request from `head` into `base`.
/// The push injects glab's token as a one-shot git credential helper (the same
/// trick as `forge_clone`) — git alone 401s on a private GitLab remote because
/// glab's token isn't in git's credential store.
pub async fn create_mr(
    state: &AppState,
    repo_path: &str,
    base: &str,
    head: &str,
    title: &str,
    body: &str,
    draft: bool,
) -> AppResult<PrRef> {
    for b in [base, head] {
        if b.is_empty() || b.starts_with('-') {
            return Err(AppError::InvalidArgument(format!("invalid branch: {b}")));
        }
    }
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidArgument("an MR title is required".into()));
    }

    // An MR needs the branch on the remote first.
    let origin =
        crate::git::remote::git_remote_url(repo_path.to_string(), "origin".to_string()).await?;
    let config = clone_credential_config(&origin).await?;
    let mut push_args: Vec<&str> = Vec::new();
    for entry in &config {
        push_args.push("-c");
        push_args.push(entry);
    }
    push_args.extend(["push", "-u", "origin", head]);
    crate::git::runner::run_git_mutating(
        state,
        repo_path,
        &push_args,
        crate::git::runner::NETWORK_TIMEOUT,
    )
    .await?;

    // GitLab drafts are the `Draft:` title prefix (no field on create).
    let full_title = if draft && !title.to_ascii_lowercase().starts_with("draft:") {
        format!("Draft: {title}")
    } else {
        title.to_string()
    };
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/merge_requests");
    let source_arg = format!("source_branch={head}");
    let target_arg = format!("target_branch={base}");
    let title_arg = format!("title={full_title}");
    let desc_arg = format!("description={body}");
    let out = run_glab(
        Some(repo_path),
        &[
            "api",
            "--method",
            "POST",
            &endpoint,
            "-f",
            &source_arg,
            "-f",
            &target_arg,
            "-f",
            &title_arg,
            "-f",
            &desc_arg,
        ],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let created: GlabCreated = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse the created merge request: {e}")))?;
    Ok(PrRef {
        number: created.iid,
        url: created.web_url,
    })
}

// ── Pipelines (CI, read) ──────────────────────────────────────────────────────
//
// GitLab pipelines map onto the same neutral `WorkflowRun`/`RunDetail`/`RunJob`
// the GitHub Actions panels render, so the frontend stays provider-agnostic. The
// two models differ in two ways we bridge here:
//   • GitLab has ONE `status` per pipeline/job; GitHub splits lifecycle (`status`)
//     from result (`conclusion`). `map_ci_status` collapses GitLab's onto both.
//   • GitHub nests run → jobs → steps; GitLab is pipeline → jobs (grouped by
//     `stage`, no per-job steps via the API), so GitLab jobs map to neutral jobs
//     with an empty `steps` list. Logs are per-job (`/jobs/<id>/trace`).
// Writes (retry / cancel / run) live at the end of this section. GitLab's retry
// restarts failed+canceled jobs only — there is no "re-run all" on an existing
// pipeline, so that one control stays GitHub-only in the UI.

/// Failed-step logs can run to many MB; keep the tail (failures land at the end).
const CI_RUN_LOG_CAP: usize = 200_000;
/// Tighter per-job cap (a job log is also fed to the AI debugger).
const CI_JOB_LOG_CAP: usize = 60_000;

/// Collapse GitLab's single pipeline/job `status` onto GitHub's two-field model:
/// `(lifecycle status, conclusion)`. A run/job is "active" while `status` isn't
/// `"completed"`, so anything still in flight maps to a non-completed lifecycle and
/// an empty conclusion; finished states carry their result in `conclusion`.
fn map_ci_status(s: &str) -> (String, String) {
    let (status, conclusion) = match s {
        "success" => ("completed", "success"),
        "failed" => ("completed", "failure"),
        "canceled" | "cancelled" => ("completed", "cancelled"),
        "skipped" => ("completed", "skipped"),
        // A pipeline blocked on a manual job — closest neutral is "needs a human".
        "manual" => ("completed", "action_required"),
        "running" => ("in_progress", ""),
        "pending" => ("pending", ""),
        "created" | "preparing" => ("queued", ""),
        "waiting_for_resource" | "scheduled" => ("waiting", ""),
        // Unknown/new GitLab state — treat as finished-neutral rather than guess.
        _ => ("completed", ""),
    };
    (status.to_string(), conclusion.to_string())
}

/// GitLab's pipeline `source` → a short label for the run's "workflow" slot
/// (GitLab has no per-workflow name; the whole `.gitlab-ci.yml` is the pipeline).
fn friendly_source(source: &str) -> String {
    match source {
        "push" => "Push",
        "web" => "Manual",
        "schedule" => "Schedule",
        "merge_request_event" => "Merge request",
        "trigger" => "Trigger",
        "pipeline" => "Multi-project",
        "api" => "API",
        "external" | "external_pull_request_event" => "External",
        "" => "Pipeline",
        other => other,
    }
    .to_string()
}

/// Keep at most `cap` bytes, preferring the tail (CI failures land at the end), on
/// a char boundary. Mirrors the GitHub log commands' truncation.
fn tail_cap(text: String, cap: usize) -> String {
    if text.len() <= cap {
        return text;
    }
    let mut start = text.len() - cap;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…(earlier output truncated)\n{}", &text[start..])
}

/// Clean a GitLab job trace into the plain text the log viewer expects: drop
/// GitLab's `section_start/end:<ts>:<name>` fold markers, ANSI CSI escapes, and
/// carriage returns — runner-formatting noise the GitHub `--log` path never emits.
fn clean_trace(raw: &str) -> String {
    // 1. Drop the markers FIRST, while the CR GitLab puts after the section name
    //    still delimits it from the visible content. (Stripping CRs first would
    //    fuse `…:prepare` into the following `Preparing…` and eat real output.)
    let mut without_markers = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(idx) = rest.find("section_") {
        without_markers.push_str(&rest[..idx]);
        let tail = &rest[idx..];
        let prefix = if tail.starts_with("section_start:") {
            "section_start:"
        } else if tail.starts_with("section_end:") {
            "section_end:"
        } else {
            // A "section_" that isn't a marker — keep it and move past.
            without_markers.push_str("section_");
            rest = &tail["section_".len()..];
            continue;
        };
        // Skip the prefix, the timestamp digits, ':' and the section name (which
        // ends at the CR before the content — non-`[A-Za-z0-9_.-]`).
        let after = &tail[prefix.len()..];
        let digits_end = after
            .char_indices()
            .find(|(_, ch)| !ch.is_ascii_digit())
            .map_or(after.len(), |(i, _)| i);
        let named = after[digits_end..].strip_prefix(':').unwrap_or(&after[digits_end..]);
        let name_end = named
            .char_indices()
            .find(|(_, ch)| !(ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-' || *ch == '.'))
            .map_or(named.len(), |(i, _)| i);
        rest = &named[name_end..];
    }
    without_markers.push_str(rest);

    // 2. Strip ANSI CSI escapes (ESC `[` … final byte 0x40–0x7E) and carriage returns.
    let mut out = String::with_capacity(without_markers.len());
    let mut it = without_markers.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\u{1b}' {
            if it.peek() == Some(&'[') {
                it.next();
                for n in it.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&n) {
                        break;
                    }
                }
            }
            continue;
        }
        if c == '\r' {
            continue;
        }
        out.push(c);
    }
    out
}

/// A GitLab pipeline as `glab api …/pipelines` returns it (list + detail core).
#[derive(Deserialize)]
struct GlabPipeline {
    id: u64,
    #[serde(default)]
    iid: u64,
    #[serde(default)]
    sha: String,
    #[serde(rename = "ref", default)]
    git_ref: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    web_url: String,
    // GitLab 15.5+ pipeline name (from `workflow:name:`); usually absent.
    #[serde(default)]
    name: Option<String>,
}

fn from_glab_pipeline(p: GlabPipeline) -> WorkflowRun {
    let (status, conclusion) = map_ci_status(&p.status);
    let workflow_name = friendly_source(&p.source);
    let name = p.name.unwrap_or_default();
    let display_title = if name.is_empty() {
        format!("Pipeline #{}", p.iid)
    } else {
        name
    };
    WorkflowRun {
        id: p.id,
        number: p.iid,
        display_title,
        status,
        conclusion,
        workflow_name,
        head_branch: p.git_ref,
        event: p.source,
        created_at: p.created_at,
        // GitLab's list payload has no per-run start time (only detail does); the
        // duration trend that uses it is GitHub-only-gated, so "" is harmless here.
        started_at: String::new(),
        updated_at: p.updated_at,
        url: p.web_url,
        head_sha: p.sha,
    }
}

/// The commit a job ran against — its title gives the pipeline detail a real header.
#[derive(Deserialize)]
struct GlabJobCommit {
    #[serde(default)]
    title: String,
}

/// One job as `glab api …/pipelines/<id>/jobs` returns it.
#[derive(Deserialize)]
struct GlabJob {
    id: u64,
    #[serde(default)]
    status: String,
    #[serde(default)]
    name: String,
    // GitLab sends `null` for a not-yet-started/finished job — absorb it.
    #[serde(default, deserialize_with = "null_to_default")]
    started_at: String,
    #[serde(default, deserialize_with = "null_to_default")]
    finished_at: String,
    #[serde(default)]
    web_url: String,
    #[serde(default)]
    commit: Option<GlabJobCommit>,
}

fn from_glab_job(j: GlabJob) -> RunJob {
    let (status, conclusion) = map_ci_status(&j.status);
    RunJob {
        id: j.id,
        name: j.name,
        status,
        conclusion,
        started_at: j.started_at,
        completed_at: j.finished_at,
        url: j.web_url,
        // GitLab exposes no per-job steps via the API — the job is the leaf unit.
        steps: Vec::new(),
    }
}

/// Recent pipelines for this repo, newest first; optionally scoped to one branch.
pub async fn list_runs(
    repo_path: &str,
    limit: u32,
    branch: Option<String>,
) -> AppResult<Vec<WorkflowRun>> {
    let enc = encode_project(&project_path(repo_path).await?);
    let per_page = limit.clamp(1, 100);
    let mut endpoint = format!("projects/{enc}/pipelines?per_page={per_page}");
    if let Some(b) = branch.as_deref().filter(|s| !s.is_empty()) {
        // Percent-encode: a branch with a query-significant char (`&`, `#`, `?`, `=`,
        // `%`) would otherwise corrupt the query and silently return the wrong
        // (unfiltered) pipeline set. `%2F` for `/` is accepted by GitLab's `ref`.
        endpoint.push_str(&format!("&ref={}", encode_query_value(b)));
    }
    let out = run_glab(Some(repo_path), &["api", &endpoint], GLAB_NETWORK_TIMEOUT).await?;
    let pipelines: Vec<GlabPipeline> = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab pipelines: {e}")))?;
    Ok(pipelines.into_iter().map(from_glab_pipeline).collect())
}

/// One pipeline with its jobs, mapped onto `RunDetail` (jobs have empty `steps`).
pub async fn view_run(repo_path: &str, run_id: u64) -> AppResult<RunDetail> {
    let enc = encode_project(&project_path(repo_path).await?);
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/pipelines/{run_id}")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let p: GlabPipeline = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab pipeline: {e}")))?;

    // Jobs — GitLab returns newest-first; reverse to execution order (stage order),
    // matching how view_pr reorders commits oldest-first.
    let mut jobs: Vec<GlabJob> = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/pipelines/{run_id}/jobs?per_page=100")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await
    .ok()
    .and_then(|o| serde_json::from_str::<Vec<GlabJob>>(&o.stdout_lossy()).ok())
    .unwrap_or_default();
    jobs.reverse();

    // Prefer the commit subject (free, from the jobs) for the header; else the
    // pipeline name; else a stable "#iid".
    let commit_title = jobs
        .iter()
        .find_map(|j| j.commit.as_ref())
        .map(|c| c.title.clone())
        .filter(|t| !t.is_empty());
    let name = p.name.clone().unwrap_or_default();
    let display_title = commit_title
        .or_else(|| (!name.is_empty()).then_some(name))
        .unwrap_or_else(|| format!("Pipeline #{}", p.iid));

    let (status, conclusion) = map_ci_status(&p.status);
    let workflow_name = friendly_source(&p.source);
    Ok(RunDetail {
        id: p.id,
        number: p.iid,
        display_title,
        status,
        conclusion,
        workflow_name,
        head_branch: p.git_ref,
        event: p.source,
        created_at: p.created_at,
        url: p.web_url,
        head_sha: p.sha,
        jobs: jobs.into_iter().map(from_glab_job).collect(),
    })
}

/// One job's log (`/jobs/<id>/trace`), cleaned of ANSI + section markers, tail-capped.
pub async fn job_logs(repo_path: &str, job_id: u64) -> AppResult<String> {
    let enc = encode_project(&project_path(repo_path).await?);
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/jobs/{job_id}/trace")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let text = clean_trace(&out.stdout_lossy());
    let text = if text.trim().is_empty() {
        "This job produced no log output.".to_string()
    } else {
        text
    };
    Ok(tail_cap(text, CI_JOB_LOG_CAP))
}

/// The failed jobs' logs for a pipeline, concatenated — GitLab's analogue of
/// `gh run view --log-failed` (which GitLab has no single endpoint for).
pub async fn run_failed_logs(repo_path: &str, run_id: u64) -> AppResult<String> {
    let enc = encode_project(&project_path(repo_path).await?);
    let jobs: Vec<GlabJob> = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/pipelines/{run_id}/jobs?per_page=100")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await
    .ok()
    .and_then(|o| serde_json::from_str::<Vec<GlabJob>>(&o.stdout_lossy()).ok())
    .unwrap_or_default();
    let failed: Vec<&GlabJob> = jobs.iter().filter(|j| j.status == "failed").collect();
    if failed.is_empty() {
        return Ok("No failed jobs in this pipeline.".to_string());
    }
    let mut text = String::new();
    for job in failed {
        if text.len() > CI_RUN_LOG_CAP {
            break;
        }
        let trace = run_glab(
            Some(repo_path),
            &["api", &format!("projects/{enc}/jobs/{}/trace", job.id)],
            GLAB_NETWORK_TIMEOUT,
        )
        .await
        .map(|o| clean_trace(&o.stdout_lossy()))
        .unwrap_or_default();
        text.push_str(&format!("===== {} =====\n", job.name));
        text.push_str(trace.trim_end());
        text.push_str("\n\n");
    }
    Ok(tail_cap(text, CI_RUN_LOG_CAP))
}

/// Retry a pipeline (`run_id` is the global pipeline id the runs list carries).
/// GitLab restarts the failed + canceled jobs of the pipeline — the analogue of
/// GitHub's "re-run failed jobs"; a full re-run of an existing pipeline doesn't
/// exist on GitLab (a *new* pipeline on the ref is a different thing).
pub async fn retry_run(repo_path: &str, run_id: u64) -> AppResult<()> {
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/pipelines/{run_id}/retry");
    run_glab(
        Some(repo_path),
        &["api", "--method", "POST", &endpoint],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Cancel an in-flight pipeline. (GitLab treats cancel on an already-finished
/// pipeline as a no-op 200, so a stale view can't error here.)
pub async fn cancel_run(repo_path: &str, run_id: u64) -> AppResult<()> {
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/pipelines/{run_id}/cancel");
    run_glab(
        Some(repo_path),
        &["api", "--method", "POST", &endpoint],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// A CI/CD variable key must be a valid env-var name. The `key:value` token
/// `glab ci run --variables-env` takes splits on the FIRST colon, so anything
/// beyond `[A-Za-z_][A-Za-z0-9_]*` (a colon especially) would corrupt the value.
fn valid_variable_key(k: &str) -> bool {
    !k.is_empty()
        && !k.starts_with(|c: char| c.is_ascii_digit())
        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// One `--variables` token: glab reads the flag's value through a CSV reader
/// (pflag StringSlice), so a bare comma in a VALUE would split it into bogus
/// extra `key:value` entries — silently corrupting the variables. A fully
/// CSV-quoted field (embedded quotes doubled) passes commas and quotes through
/// intact (validated live: `"REGIONS:a,b"` → one variable `a,b`).
fn variable_token(key: &str, value: &str) -> String {
    format!("\"{key}:{}\"", value.replace('"', "\"\""))
}

/// Manually run a new pipeline on a ref — GitLab's analogue of a workflow
/// dispatch. `variables` become CI/CD env variables via `glab ci run`'s
/// `--variables key:value` tokens, CSV-quoted (see [`variable_token`]) — the
/// REST `variables[]` array form doesn't survive glab's `-f` field encoding, so
/// the purpose-built subcommand is the safe path.
pub async fn run_pipeline(
    repo_path: &str,
    git_ref: &str,
    variables: &HashMap<String, String>,
) -> AppResult<()> {
    if git_ref.is_empty() || git_ref.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid ref: {git_ref}")));
    }
    let mut args: Vec<String> = vec!["ci".into(), "run".into(), "-b".into(), git_ref.into()];
    for (k, v) in variables {
        if !valid_variable_key(k) {
            return Err(AppError::InvalidArgument(format!(
                "invalid variable name: {k} (letters, digits and _ only)"
            )));
        }
        args.push("--variables".into());
        args.push(variable_token(k, v));
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_glab(Some(repo_path), &arg_refs, GLAB_NETWORK_TIMEOUT).await?;
    Ok(())
}

// ── Releases (read) ───────────────────────────────────────────────────────────
//
// GitLab releases map onto the same neutral `ReleaseInfo`/`ReleaseDetails` the
// GitHub Tags panel renders, so the frontend stays provider-agnostic. The two
// models differ in a few ways we bridge here:
//   • GitLab has no draft or prerelease concept — both map to `false`.
//   • GitLab has no per-release "latest" flag; the list comes back `released_at`-
//     desc, so the newest non-upcoming release is GitLab's own "latest" — we mark
//     just that one.
//   • The release web URL is `_links.self` (not a top-level `web_url` like MRs).
//   • GitLab release assets are `links` (named URLs, no size/download count) plus
//     auto-generated source archives; we surface only the user `links` — mirroring
//     `gh`, which likewise omits source archives — with size/downloads 0, so the
//     UI renders them as plain external links, not downloadable binaries.
// Writes (create / edit / delete / asset upload+delete) live at the end of this
// section; the GitHub-only draft / prerelease / latest toggles are dropped by the
// forge dispatch before reaching here.

#[derive(Deserialize)]
struct GlabReleaseAuthor {
    #[serde(default)]
    username: String,
}

/// One user-attached release asset link (`assets.links[]`). GitLab also returns
/// `direct_asset_url` (resolves through the project) — prefer it over the raw `url`.
#[derive(Deserialize)]
struct GlabReleaseLink {
    #[serde(default)]
    name: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    direct_asset_url: String,
}

#[derive(Deserialize, Default)]
struct GlabReleaseAssets {
    #[serde(default, deserialize_with = "null_to_default")]
    links: Vec<GlabReleaseLink>,
}

/// The `_links` block — we only need the release's own web URL (`self`).
#[derive(Deserialize, Default)]
struct GlabReleaseSelfLink {
    #[serde(rename = "self", default)]
    self_url: String,
}

/// A release as `glab api …/releases[/<tag>]` returns it (list + detail share one
/// shape). `description` is the markdown body; `released_at` is the publish time.
#[derive(Deserialize)]
struct GlabRelease {
    #[serde(default)]
    tag_name: String,
    #[serde(default)]
    name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    description: String,
    #[serde(default)]
    released_at: String,
    #[serde(default)]
    created_at: String,
    /// A release scheduled for a future `released_at` (GitLab's nearest thing to an
    /// unpublished state); it's still listed, and is never the "latest".
    #[serde(default)]
    upcoming_release: bool,
    #[serde(default)]
    author: Option<GlabReleaseAuthor>,
    #[serde(default, deserialize_with = "null_to_default")]
    assets: GlabReleaseAssets,
    #[serde(rename = "_links", default, deserialize_with = "null_to_default")]
    links: GlabReleaseSelfLink,
}

fn from_glab_release_link(l: GlabReleaseLink) -> ReleaseAsset {
    ReleaseAsset {
        name: l.name,
        // GitLab asset links carry no size or download count.
        size: 0,
        download_count: 0,
        url: if l.direct_asset_url.is_empty() {
            l.url
        } else {
            l.direct_asset_url
        },
    }
}

/// The release's publish time — `released_at`, falling back to `created_at`.
fn release_published_at(r: &GlabRelease) -> String {
    if r.released_at.is_empty() {
        r.created_at.clone()
    } else {
        r.released_at.clone()
    }
}

/// Map a GitLab release onto the neutral list-row `ReleaseInfo`. `is_latest` is
/// decided by the caller (the newest non-upcoming release) since GitLab has no
/// per-release latest flag.
fn release_info(r: &GlabRelease, is_latest: bool) -> ReleaseInfo {
    ReleaseInfo {
        tag_name: r.tag_name.clone(),
        name: r.name.clone(),
        // GitLab has neither draft nor prerelease releases.
        is_draft: false,
        is_prerelease: false,
        is_latest,
        published_at: release_published_at(r),
    }
}

/// Mark the newest non-upcoming release "latest". GitLab returns releases
/// `released_at`-desc, so the first non-upcoming entry is GitLab's own default
/// "latest" — every other row (and any upcoming ones) stays non-latest.
fn releases_to_infos(releases: &[GlabRelease]) -> Vec<ReleaseInfo> {
    let latest_idx = releases.iter().position(|r| !r.upcoming_release);
    releases
        .iter()
        .enumerate()
        .map(|(i, r)| release_info(r, Some(i) == latest_idx))
        .collect()
}

/// Map a GitLab release onto the neutral detail `ReleaseDetails`.
fn release_details(r: GlabRelease) -> ReleaseDetails {
    let published_at = release_published_at(&r);
    ReleaseDetails {
        tag_name: r.tag_name,
        name: r.name,
        body: r.description,
        author: r.author.map(|a| a.username).unwrap_or_default(),
        published_at,
        is_draft: false,
        is_prerelease: false,
        // GitLab releases have no GitHub-style "target commitish" the read view acts
        // on (the tag's commit is implicit); leave empty (display-only on GitHub).
        target_commitish: String::new(),
        url: r.links.self_url,
        assets: r
            .assets
            .links
            .into_iter()
            .map(from_glab_release_link)
            .collect(),
    }
}

/// The repo's releases for the Tags panel (newest first), capped at 100 to match
/// the GitHub path (`gh release list --limit 100`).
pub async fn list_releases(repo_path: &str) -> AppResult<Vec<ReleaseInfo>> {
    let enc = encode_project(&project_path(repo_path).await?);
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/releases?per_page=100")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let releases: Vec<GlabRelease> = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab releases: {e}")))?;
    Ok(releases_to_infos(&releases))
}

/// Full read view of one release, by its tag, mapped onto `ReleaseDetails`.
pub async fn view_release(repo_path: &str, tag: &str) -> AppResult<ReleaseDetails> {
    if tag.is_empty() {
        return Err(AppError::InvalidArgument("a tag is required".into()));
    }
    let enc = encode_project(&project_path(repo_path).await?);
    // The tag is a single path segment — percent-encode it so a `/` in a tag like
    // `release/1.0` (or any query-significant byte) can't break the endpoint path.
    let enc_tag = encode_query_value(tag);
    let out = run_glab(
        Some(repo_path),
        &["api", &format!("projects/{enc}/releases/{enc_tag}")],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let r: GlabRelease = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab release: {e}")))?;
    Ok(release_details(r))
}

/// Publish a release; returns its web URL (`_links.self`). `target` is the ref to
/// create the tag from when the tag doesn't exist yet — the dialog only sends it
/// for a brand-new tag, and GitLab requires it then (a clear server error surfaces
/// if it's missing). Empty title/notes are simply omitted, mirroring the gh path.
pub async fn create_release(
    repo_path: &str,
    tag: &str,
    title: &str,
    notes: &str,
    target: &str,
) -> AppResult<String> {
    if tag.is_empty() || tag.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid tag: {tag}")));
    }
    let enc = encode_project(&project_path(repo_path).await?);
    let endpoint = format!("projects/{enc}/releases");
    let mut args: Vec<String> = vec![
        "api".into(),
        "--method".into(),
        "POST".into(),
        endpoint,
        "-f".into(),
        format!("tag_name={tag}"),
    ];
    if !target.trim().is_empty() {
        args.push("-f".into());
        args.push(format!("ref={}", target.trim()));
    }
    if !title.trim().is_empty() {
        args.push("-f".into());
        args.push(format!("name={}", title.trim()));
    }
    if !notes.trim().is_empty() {
        args.push("-f".into());
        args.push(format!("description={notes}"));
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run_glab(Some(repo_path), &arg_refs, GLAB_NETWORK_TIMEOUT).await?;
    let r: GlabRelease = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse created GitLab release: {e}")))?;
    Ok(r.links.self_url)
}

/// Edit a release's title and/or notes. Empty fields are left unchanged (the gh
/// path likewise only passes non-empty `--title`/`--notes`); when both are empty
/// there's nothing to send, so it's a no-op.
pub async fn edit_release(repo_path: &str, tag: &str, title: &str, notes: &str) -> AppResult<()> {
    if tag.is_empty() {
        return Err(AppError::InvalidArgument("a tag is required".into()));
    }
    let enc = encode_project(&project_path(repo_path).await?);
    let enc_tag = encode_query_value(tag);
    let endpoint = format!("projects/{enc}/releases/{enc_tag}");
    let mut args: Vec<String> = vec!["api".into(), "--method".into(), "PUT".into(), endpoint];
    if !title.trim().is_empty() {
        args.push("-f".into());
        args.push(format!("name={}", title.trim()));
    }
    if !notes.trim().is_empty() {
        args.push("-f".into());
        args.push(format!("description={notes}"));
    }
    if args.len() == 4 {
        return Ok(());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_glab(Some(repo_path), &arg_refs, GLAB_NETWORK_TIMEOUT).await?;
    Ok(())
}

/// Delete a release; `cleanup_tag` also deletes the git tag afterwards (mirroring
/// `gh release delete --cleanup-tag` — GitLab's release delete never touches the tag).
pub async fn delete_release(repo_path: &str, tag: &str, cleanup_tag: bool) -> AppResult<()> {
    if tag.is_empty() {
        return Err(AppError::InvalidArgument("a tag is required".into()));
    }
    let enc = encode_project(&project_path(repo_path).await?);
    let enc_tag = encode_query_value(tag);
    let endpoint = format!("projects/{enc}/releases/{enc_tag}");
    run_glab(
        Some(repo_path),
        &["api", "--method", "DELETE", &endpoint],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    if cleanup_tag {
        let tag_endpoint = format!("projects/{enc}/repository/tags/{enc_tag}");
        run_glab(
            Some(repo_path),
            &["api", "--method", "DELETE", &tag_endpoint],
            GLAB_NETWORK_TIMEOUT,
        )
        .await?;
    }
    Ok(())
}

/// Upload a file as a release asset via `glab release upload` — it uploads to the
/// project and attaches an asset link named after the file, with a direct download
/// URL. glab parses `#` in the file argument as its display-name separator
/// (`file#name#type`), so a `#`-bearing path can't be passed unambiguously — reject
/// it rather than upload under a mangled name.
pub async fn upload_release_asset(repo_path: &str, tag: &str, file_path: &str) -> AppResult<()> {
    if tag.is_empty() || tag.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid tag: {tag}")));
    }
    if file_path.is_empty() || file_path.starts_with('-') {
        return Err(AppError::InvalidArgument("a file is required".into()));
    }
    if file_path.contains('#') {
        return Err(AppError::InvalidArgument(
            "GitLab uploads can't handle a '#' in the file path — rename or move the file first."
                .into(),
        ));
    }
    run_glab(
        Some(repo_path),
        &["release", "upload", tag, file_path],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Delete a release asset link by its display name. GitLab keys links by a
/// server-side id, so resolve the name against the release's links first; a
/// missing name errors (the view may be stale) rather than deleting the wrong link.
pub async fn delete_release_asset(repo_path: &str, tag: &str, asset_name: &str) -> AppResult<()> {
    #[derive(Deserialize)]
    struct Link {
        id: u64,
        #[serde(default)]
        name: String,
    }
    if tag.is_empty() {
        return Err(AppError::InvalidArgument("a tag is required".into()));
    }
    if asset_name.is_empty() {
        return Err(AppError::InvalidArgument("an asset name is required".into()));
    }
    let enc = encode_project(&project_path(repo_path).await?);
    let enc_tag = encode_query_value(tag);
    let list_endpoint = format!("projects/{enc}/releases/{enc_tag}/assets/links");
    let out = run_glab(
        Some(repo_path),
        &["api", &list_endpoint],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    let links: Vec<Link> = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Glab(format!("could not parse GitLab release assets: {e}")))?;
    let link = links
        .into_iter()
        .find(|l| l.name == asset_name)
        .ok_or_else(|| AppError::Glab(format!("no release asset named {asset_name}")))?;
    let del_endpoint = format!("projects/{enc}/releases/{enc_tag}/assets/links/{}", link.id);
    run_glab(
        Some(repo_path),
        &["api", "--method", "DELETE", &del_endpoint],
        GLAB_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
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
        // …issue reads, and CI pipeline reads.
        assert!(s.implemented.issues && s.implemented.ci);
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
    fn maps_glab_issue_to_neutral_issue() {
        let json = r#"{
            "iid": 3,
            "web_url": "https://gitlab.com/g/r/-/issues/3",
            "title": "Add dark mode toggle",
            "state": "opened",
            "created_at": "2026-06-30T00:36:04Z",
            "updated_at": "2026-06-30T01:00:00Z",
            "author": { "username": "alice" },
            "labels": ["enhancement"]
        }"#;
        let i = from_glab_issue(serde_json::from_str(json).unwrap());
        assert_eq!(i.number, 3);
        assert_eq!(i.url, "https://gitlab.com/g/r/-/issues/3");
        assert_eq!(i.state, "OPEN");
        assert_eq!(i.created_at, "2026-06-30T00:36:04Z");
        assert_eq!(i.updated_at, "2026-06-30T01:00:00Z");
        assert_eq!(i.author.unwrap().login, "alice");
        assert_eq!(i.labels.len(), 1);
        assert_eq!(i.labels[0].name, "enhancement");
    }

    #[test]
    fn issue_state_maps_to_neutral() {
        assert_eq!(map_issue_state("opened"), "OPEN");
        assert_eq!(map_issue_state("closed"), "CLOSED");
        // Unknown states upper-case rather than panic (issues never report merged).
        assert_eq!(map_issue_state("weird"), "WEIRD");
    }

    #[test]
    fn issue_detail_tolerates_null_collections_and_scalars() {
        // GitLab can send `null` (not `[]`/`false`/omitted) for any of these, and a
        // bare field with only `#[serde(default)]` fails the WHOLE parse on a present
        // `null` — the "Could not load this issue" dogfood bug. `null_to_default`
        // must absorb every one (labels, assignees, milestone, discussion_locked).
        let json = r#"{
            "iid": 2,
            "web_url": "https://gitlab.com/g/r/-/issues/2",
            "title": "Crash when cloning an empty repository",
            "description": "Steps to reproduce…",
            "state": "opened",
            "created_at": "2026-06-30T00:36:04.349Z",
            "author": { "username": "theBGuy" },
            "labels": null,
            "assignees": null,
            "milestone": null,
            "discussion_locked": null
        }"#;
        let issue: GlabIssueDetail = serde_json::from_str(json).unwrap();
        assert_eq!(issue.iid, 2);
        assert!(!issue.discussion_locked);
        assert!(issue.milestone.is_none());
        assert!(issue.labels.is_empty());
        assert!(issue.assignees.is_empty());
    }

    #[test]
    fn issue_detail_maps_populated_milestone_and_assignees() {
        // The happy path: a present milestone + assignees + labels deserialize and
        // carry through (locks the mapping the null test can't exercise).
        let json = r#"{
            "iid": 5,
            "web_url": "https://gitlab.com/g/r/-/issues/5",
            "title": "Polish onboarding",
            "description": "",
            "state": "closed",
            "created_at": "2026-06-30T00:00:00Z",
            "author": { "username": "alice" },
            "labels": ["enhancement", "ui"],
            "assignees": [{ "username": "bob" }, { "username": "carol" }],
            "milestone": { "iid": 3, "title": "v1.0" },
            "discussion_locked": true
        }"#;
        let issue: GlabIssueDetail = serde_json::from_str(json).unwrap();
        assert_eq!(issue.labels, vec!["enhancement".to_string(), "ui".to_string()]);
        assert_eq!(issue.assignees.len(), 2);
        assert_eq!(issue.assignees[0].username, "bob");
        let m = issue.milestone.as_ref().unwrap();
        assert_eq!(m.iid, 3);
        assert_eq!(m.title, "v1.0");
        assert!(issue.discussion_locked);
    }

    #[test]
    fn ci_status_maps_to_neutral_two_field_model() {
        assert_eq!(map_ci_status("success"), ("completed".into(), "success".into()));
        assert_eq!(map_ci_status("failed"), ("completed".into(), "failure".into()));
        assert_eq!(map_ci_status("canceled"), ("completed".into(), "cancelled".into()));
        assert_eq!(map_ci_status("skipped"), ("completed".into(), "skipped".into()));
        assert_eq!(map_ci_status("manual"), ("completed".into(), "action_required".into()));
        // In-flight states map to a non-completed lifecycle (so the UI keeps polling).
        assert_eq!(map_ci_status("running"), ("in_progress".into(), String::new()));
        assert_eq!(map_ci_status("pending"), ("pending".into(), String::new()));
        assert_eq!(map_ci_status("created"), ("queued".into(), String::new()));
    }

    #[test]
    fn maps_glab_pipeline_to_neutral_run() {
        let json = r#"{
            "id": 999,
            "iid": 12,
            "sha": "abc123",
            "ref": "feature/dark-mode",
            "status": "failed",
            "source": "push",
            "created_at": "2026-06-30T00:35:25Z",
            "updated_at": "2026-06-30T00:35:53Z",
            "web_url": "https://gitlab.com/g/r/-/pipelines/999",
            "name": null
        }"#;
        let run = from_glab_pipeline(serde_json::from_str(json).unwrap());
        assert_eq!(run.id, 999);
        assert_eq!(run.number, 12);
        // No pipeline name → a stable "#iid" title.
        assert_eq!(run.display_title, "Pipeline #12");
        assert_eq!(run.workflow_name, "Push");
        assert_eq!(run.head_branch, "feature/dark-mode");
        assert_eq!(run.status, "completed");
        assert_eq!(run.conclusion, "failure");
        assert_eq!(run.head_sha, "abc123");
    }

    #[test]
    fn maps_glab_job_to_neutral_with_no_steps() {
        // A not-yet-started job sends `started_at: null` — must absorb, not sink.
        let json = r#"{
            "id": 5151,
            "status": "skipped",
            "stage": "build",
            "name": "build",
            "started_at": null,
            "finished_at": null,
            "web_url": "https://gitlab.com/g/r/-/jobs/5151"
        }"#;
        let job = from_glab_job(serde_json::from_str(json).unwrap());
        assert_eq!(job.id, 5151);
        assert_eq!(job.name, "build");
        assert_eq!(job.status, "completed");
        assert_eq!(job.conclusion, "skipped");
        assert_eq!(job.started_at, "");
        assert!(job.steps.is_empty());
    }

    #[test]
    fn cleans_gitlab_trace_of_ansi_and_section_markers() {
        let raw = "\u{1b}[0Ksection_start:1718000000:prepare\rPreparing\u{1b}[0;m\nsection_end:1718000000:prepare\r\u{1b}[32;1mDone\u{1b}[0m\n";
        let cleaned = clean_trace(raw);
        assert!(!cleaned.contains('\u{1b}'), "ANSI escapes remain: {cleaned:?}");
        assert!(!cleaned.contains('\r'));
        assert!(!cleaned.contains("section_start"));
        assert!(!cleaned.contains("section_end"));
        assert!(cleaned.contains("Preparing"));
        assert!(cleaned.contains("Done"));
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

    #[test]
    fn encodes_query_significant_chars_in_a_branch_ref() {
        // The plain branch name survives; `/` and query-significant chars encode so
        // `glab api`'s verbatim query can't be corrupted/split.
        assert_eq!(encode_query_value("feature/dark-mode"), "feature%2Fdark-mode");
        assert_eq!(encode_query_value("fix_bug.v2"), "fix_bug.v2");
        assert_eq!(encode_query_value("a&b=c#d"), "a%26b%3Dc%23d");
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

    // Sample JSON below mirrors the real `glab api …/releases` shape (validated live).
    #[test]
    fn maps_glab_release_to_neutral_info() {
        let json = r#"{
            "tag_name": "v1.0.0",
            "name": "v1.0.0 — stable",
            "description": "First **stable** release.",
            "released_at": "2026-06-30T07:06:16.417Z",
            "created_at": "2026-06-30T07:06:16.417Z",
            "upcoming_release": false,
            "author": { "username": "theBGuy" },
            "assets": { "links": [] },
            "_links": { "self": "https://gitlab.com/g/r/-/releases/v1.0.0" }
        }"#;
        let r: GlabRelease = serde_json::from_str(json).unwrap();
        let info = release_info(&r, true);
        assert_eq!(info.tag_name, "v1.0.0");
        assert_eq!(info.name, "v1.0.0 — stable");
        // GitLab has neither draft nor prerelease releases.
        assert!(!info.is_draft && !info.is_prerelease);
        assert!(info.is_latest);
        assert_eq!(info.published_at, "2026-06-30T07:06:16.417Z");
    }

    #[test]
    fn release_detail_maps_description_url_and_asset_links() {
        let json = r#"{
            "tag_name": "v1.0.0",
            "name": "v1.0.0",
            "description": "Body text",
            "released_at": "2026-06-30T07:06:16.417Z",
            "created_at": "2026-06-30T07:00:00Z",
            "upcoming_release": false,
            "author": { "username": "theBGuy" },
            "assets": { "links": [
                { "id": 1, "name": "Release notes (README)", "url": "https://x/u", "direct_asset_url": "https://x/direct", "link_type": "other" }
            ] },
            "_links": { "self": "https://gitlab.com/g/r/-/releases/v1.0.0" }
        }"#;
        let d = release_details(serde_json::from_str(json).unwrap());
        assert_eq!(d.body, "Body text");
        assert_eq!(d.author, "theBGuy");
        assert_eq!(d.url, "https://gitlab.com/g/r/-/releases/v1.0.0");
        assert!(!d.is_draft && !d.is_prerelease);
        assert_eq!(d.published_at, "2026-06-30T07:06:16.417Z");
        assert_eq!(d.assets.len(), 1);
        assert_eq!(d.assets[0].name, "Release notes (README)");
        // Asset links have no size/downloads; the direct asset URL is preferred.
        assert_eq!(d.assets[0].size, 0);
        assert_eq!(d.assets[0].download_count, 0);
        assert_eq!(d.assets[0].url, "https://x/direct");
    }

    #[test]
    fn release_tolerates_null_description_and_missing_links() {
        // A release with no description / no assets / no `_links`: GitLab can send
        // `null` for the body, and `#[serde(default)]` alone would sink a present
        // `null` — `null_to_default` must absorb it (same trap as the issue parse).
        let json = r#"{
            "tag_name": "v0.1.0",
            "name": "",
            "description": null,
            "released_at": "2026-06-30T00:00:00Z",
            "upcoming_release": false
        }"#;
        let d = release_details(serde_json::from_str(json).unwrap());
        assert_eq!(d.tag_name, "v0.1.0");
        assert_eq!(d.body, "");
        assert_eq!(d.url, "");
        assert!(d.assets.is_empty());
        // Falls back to released_at for the publish time.
        assert_eq!(d.published_at, "2026-06-30T00:00:00Z");
    }

    #[test]
    fn newest_non_upcoming_release_is_marked_latest() {
        // The list comes back released_at-desc; an upcoming (scheduled) release can
        // sit at the top but must NOT be "latest" — the first non-upcoming is.
        let mk = |tag: &str, upcoming: bool| -> GlabRelease {
            serde_json::from_str(&format!(
                r#"{{ "tag_name": "{tag}", "name": "{tag}", "released_at": "2026-06-30T00:00:00Z", "upcoming_release": {upcoming} }}"#
            ))
            .unwrap()
        };
        let list = vec![mk("v2.0.0-next", true), mk("v1.1.0", false), mk("v1.0.0", false)];
        let infos = releases_to_infos(&list);
        assert!(!infos[0].is_latest, "an upcoming release is never latest");
        assert!(infos[1].is_latest, "the newest published release is latest");
        assert!(!infos[2].is_latest);
    }

    #[test]
    fn pipeline_variable_keys_reject_colon_and_flaggy_names() {
        // The `key:value` token splits on the FIRST colon — a colon-bearing key
        // would silently corrupt the value, and a leading digit isn't an env var.
        assert!(valid_variable_key("DEPLOY_ENV"));
        assert!(valid_variable_key("_private"));
        assert!(valid_variable_key("key2"));
        assert!(!valid_variable_key(""));
        assert!(!valid_variable_key("has:colon"));
        assert!(!valid_variable_key("has space"));
        assert!(!valid_variable_key("2leading"));
        assert!(!valid_variable_key("-flag"));
    }

    #[test]
    fn pipeline_variable_values_survive_commas_and_quotes() {
        // glab CSV-splits the --variables flag value; the token must be a fully
        // quoted CSV field with embedded quotes doubled (forms validated live).
        assert_eq!(variable_token("KEY", "simple"), "\"KEY:simple\"");
        assert_eq!(variable_token("REGIONS", "us-east-1,eu-west-1"), "\"REGIONS:us-east-1,eu-west-1\"");
        assert_eq!(variable_token("NOTE", "say \"hi\", ok"), "\"NOTE:say \"\"hi\"\", ok\"");
        assert_eq!(variable_token("MSG", "hello: world"), "\"MSG:hello: world\"");
    }

    #[test]
    fn mr_changes_parse_assignees_present_null_and_missing() {
        // GitLab sends `assignees: []` normally, but nullable collections must
        // tolerate an explicit `null` (the null_to_default trap) and absence.
        let base = r#""iid": 1, "web_url": "u", "title": "t", "target_branch": "main",
            "source_branch": "f", "state": "opened""#;
        let with = format!(
            r#"{{ {base}, "assignees": [ {{ "username": "alice" }}, {{ "username": "bob" }} ] }}"#
        );
        let mr: GlabMrChanges = serde_json::from_str(&with).unwrap();
        let names: Vec<String> = mr.assignees.into_iter().map(|a| a.username).collect();
        assert_eq!(names, vec!["alice", "bob"]);

        let with_null = format!(r#"{{ {base}, "assignees": null }}"#);
        let mr: GlabMrChanges = serde_json::from_str(&with_null).unwrap();
        assert!(mr.assignees.is_empty());

        let missing = format!("{{ {base} }}");
        let mr: GlabMrChanges = serde_json::from_str(&missing).unwrap();
        assert!(mr.assignees.is_empty());
    }

    #[test]
    fn release_published_at_falls_back_to_created_at() {
        let r: GlabRelease = serde_json::from_str(
            r#"{ "tag_name": "v1", "name": "v1", "created_at": "2026-01-01T00:00:00Z" }"#,
        )
        .unwrap();
        assert_eq!(release_published_at(&r), "2026-01-01T00:00:00Z");
    }
}
