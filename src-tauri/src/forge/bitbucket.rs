//! The Bitbucket Cloud [`Forge`](super::Forge) implementation, over direct HTTPS
//! (`api.bitbucket.org/2.0`) via the [`http`](super::http) layer.
//!
//! Like the GitLab impl, every read maps Bitbucket's JSON onto the SAME neutral
//! models the GitHub panels render (`PrInfo`, `PrDetails`, `WorkflowRun`, …), so the
//! frontend stays provider-agnostic. Bitbucket is READ-ONLY here (Phase 3): PRs,
//! pipelines, and repo listing/URL — no writes, no issues (the native tracker is
//! being deleted platform-wide 2026-08-20), no reactions/labels/milestones (the
//! platform has none of those on Cloud).
//!
//! Auth is HTTP Basic (`{atlassian_account_email}:{api_token}`) — app passwords are
//! dead — with the token stored in the OS keyring under `forge/bitbucket.org/*`.
//!
//! Pagination policy matches GitLab: a single page at the endpoint's max `pagelen`,
//! no `next`-following loops (documented per call). The PR-list endpoint caps at 50;
//! repos/pipelines allow 100.

use serde::Deserialize;
use tauri_plugin_http::reqwest;

use crate::error::{AppError, AppResult};
use crate::forge::encode_query_value;
use crate::forge::gitlab::null_to_default;
use crate::forge::http::{self, BbCredentials, BB_HOST, KEY_EMAIL, KEY_TOKEN, KEY_USERNAME};
use crate::forge::model::{
    Capabilities, ForgeRepo, ForgeRepoList, ForgeStatus, Implemented, Provider,
};
use crate::forge::Forge;
use crate::github::actions::{RunDetail, RunJob, WorkflowRun};
use crate::github::pr::{
    ApprovalState, PrAuthor, PrCommitOut, PrDetails, PrFileOut, PrInfo, PrListLabel, PrRef,
    PrThreadOut,
};

/// Failed-step logs can run to many MB; keep the tail (failures land at the end).
const CI_RUN_LOG_CAP: usize = 200_000;
/// Tighter per-step cap (a step log is also fed to the AI debugger).
const CI_STEP_LOG_CAP: usize = 60_000;
/// Cap the PR diff like the gh/gitlab paths so a pathological PR can't blow up the viewer.
const PR_DIFF_CAP: usize = 2_000_000;

/// Bitbucket Cloud, over HTTPS. Carries the repo's host (always `bitbucket.org` for
/// Cloud; Bitbucket Server is out of scope).
pub struct BitbucketForge {
    host: String,
}

impl BitbucketForge {
    pub fn new(host: String) -> Self {
        Self { host }
    }
}

// ── Status ────────────────────────────────────────────────────────────────────

/// Assemble the neutral status from the Bitbucket probes. Pure (testable), mirroring
/// `gitlab_status`: `installed` = a token is stored, `authenticated` = the `/user`
/// probe succeeded, `login` = the resolved username/display name, `repo` = the
/// workspace/slug from the origin remote (filled regardless of auth).
fn bitbucket_status(
    installed: bool,
    authenticated: bool,
    host: &str,
    repo: Option<String>,
    login: Option<String>,
) -> ForgeStatus {
    ForgeStatus {
        provider: Some(Provider::Bitbucket),
        installed,
        authenticated,
        repo,
        host: Some(host.to_string()),
        login,
        capabilities: Capabilities::for_provider(Provider::Bitbucket),
        implemented: Implemented::for_provider(Provider::Bitbucket),
    }
}

impl Forge for BitbucketForge {
    async fn status(&self, repo_path: &str) -> AppResult<ForgeStatus> {
        // The workspace/slug from the origin remote — filled regardless of auth,
        // mirroring GitLab (a recognized-but-signed-out repo still shows its slug).
        let repo = workspace_slug(repo_path)
            .await
            .ok()
            .map(|(w, s)| format!("{w}/{s}"));

        // No token stored → installed:false and NO network call at all.
        let creds = match http::load_credentials().await {
            Ok(c) => c,
            Err(AppError::BitbucketNotConfigured) => {
                return Ok(bitbucket_status(false, false, &self.host, repo, None));
            }
            Err(e) => return Err(e),
        };

        // Token present. Probe `/user`; a success authenticates and yields the login.
        match http::bb_get_json::<BbUser>(&creds, "user", "user").await {
            Ok(user) => {
                let login = user.username.or(user.display_name);
                Ok(bitbucket_status(true, true, &self.host, repo, login))
            }
            // A stored-but-invalid/expired token: installed (we have one) but not
            // authenticated. Fall back to the stored username for the login label.
            Err(AppError::Bitbucket(_)) => {
                let login = read_stored_username().await;
                Ok(bitbucket_status(true, false, &self.host, repo, login))
            }
            Err(e) => Err(e),
        }
    }
}

/// The workspace + repo slug (`{workspace}/{slug}`) from the repo's origin remote.
async fn workspace_slug(repo_path: &str) -> AppResult<(String, String)> {
    let url =
        crate::git::remote::git_remote_url(repo_path.to_string(), "origin".to_string()).await?;
    let path = crate::forge::remote_path(&url).ok_or_else(|| {
        AppError::Bitbucket(
            "could not determine the Bitbucket repository from the origin remote".into(),
        )
    })?;
    // Bitbucket repo paths are exactly `workspace/slug` (no nested groups).
    let mut parts = path.splitn(2, '/');
    match (parts.next(), parts.next()) {
        (Some(w), Some(s)) if !w.is_empty() && !s.is_empty() => Ok((w.to_string(), s.to_string())),
        _ => Err(AppError::Bitbucket(format!(
            "unexpected Bitbucket repository path: {path}"
        ))),
    }
}

/// Read the stored username from the keyring (best-effort, no network).
async fn read_stored_username() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::secrets::read_forge_secret(BB_HOST, KEY_USERNAME)
            .ok()
            .flatten()
    })
    .await
    .ok()
    .flatten()
    .filter(|s| !s.is_empty())
}

// ── Account commands (set / clear / read) ──────────────────────────────────────

/// The account info returned to the frontend after connecting (or when reading the
/// stored account). The TOKEN is never included — it stays in the keyring only.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BbAccountInfo {
    pub email: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
}

/// A Bitbucket user (`/2.0/user`, or an embedded author object). For other users
/// `username` is absent (privacy) — only the authenticated self carries it, so the
/// stable cross-user identity is `uuid` (braced, present on every user object). The
/// avatar link is deliberately not deserialized (unused by the neutral model).
#[derive(Deserialize)]
struct BbUser {
    /// The braced account UUID (`{…}`) — the ONE identity field present on both the
    /// self object and other users' participant objects, so it's what reconciles the
    /// viewer against a PR participant.
    #[serde(default)]
    uuid: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    nickname: Option<String>,
}

/// Connect a Bitbucket account: validate the creds via `GET /2.0/user` BEFORE
/// persisting anything (a pre-mutation guard — nothing is written if validation
/// fails), then store email/token/username in the keyring and return the account
/// info (never the token). The error distinguishes a network failure from a 401
/// invalid-token (`http_error` special-cases 401).
pub async fn set_account(email: &str, token: &str) -> AppResult<BbAccountInfo> {
    let email = email.trim().to_string();
    let token = token.trim().to_string();
    if email.is_empty() || token.is_empty() {
        return Err(AppError::InvalidArgument(
            "an email and API token are both required".into(),
        ));
    }
    // Validate with the provided creds (not the stored ones) before writing.
    let creds = BbCredentials {
        email: email.clone(),
        token: token.clone(),
    };
    let user: BbUser = http::bb_get_json(&creds, "user", "user").await?;
    let username = user.username.clone();
    let display_name = user.display_name.clone();

    // Validated — persist all three entries (blocking keyring writes off-thread).
    let (kr_email, kr_token, kr_username) = (email.clone(), token.clone(), username.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::secrets::set_forge_secret(BB_HOST, KEY_EMAIL, &kr_email)?;
        crate::secrets::set_forge_secret(BB_HOST, KEY_TOKEN, &kr_token)?;
        // Store the username too (drives the signed-out `login` label); clear a
        // stale one if the account has no username.
        match &kr_username {
            Some(u) if !u.is_empty() => crate::secrets::set_forge_secret(BB_HOST, KEY_USERNAME, u)?,
            _ => crate::secrets::delete_forge_secret(BB_HOST, KEY_USERNAME)?,
        }
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Bitbucket(format!("keyring task failed: {e}")))??;

    Ok(BbAccountInfo {
        email,
        username,
        display_name,
    })
}

/// Disconnect the Bitbucket account — delete all three keyring entries (a missing
/// entry is tolerated).
pub async fn clear_account() -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::secrets::delete_forge_secret(BB_HOST, KEY_EMAIL)?;
        crate::secrets::delete_forge_secret(BB_HOST, KEY_TOKEN)?;
        crate::secrets::delete_forge_secret(BB_HOST, KEY_USERNAME)?;
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Bitbucket(format!("keyring task failed: {e}")))?
}

/// The stored account (keyring existence read ONLY — no network). `None` when no
/// token is stored. The token is never returned.
pub async fn account() -> AppResult<Option<BbAccountInfo>> {
    tauri::async_runtime::spawn_blocking(|| {
        let email = crate::secrets::read_forge_secret(BB_HOST, KEY_EMAIL)?;
        let token = crate::secrets::read_forge_secret(BB_HOST, KEY_TOKEN)?;
        let username = crate::secrets::read_forge_secret(BB_HOST, KEY_USERNAME)?;
        Ok::<_, AppError>(match (email, token) {
            (Some(email), Some(token)) if !email.is_empty() && !token.is_empty() => {
                Some(BbAccountInfo {
                    email,
                    username: username.filter(|u| !u.is_empty()),
                    display_name: None,
                })
            }
            _ => None,
        })
    })
    .await
    .map_err(|e| AppError::Bitbucket(format!("keyring task failed: {e}")))?
}

// ── Shared JSON shapes ─────────────────────────────────────────────────────────

/// A Bitbucket link object (`{href}`); many are optional.
#[derive(Deserialize, Default, Clone)]
struct BbLink {
    #[serde(default)]
    href: String,
}

/// A named clone link (`{name: "https"|"ssh", href}`).
#[derive(Deserialize, Default)]
struct BbCloneLink {
    #[serde(default)]
    name: String,
    #[serde(default)]
    href: String,
}

/// A paginated envelope (`{values, …}`). `next` is ignored under the single-page
/// policy; kept undeserialized.
#[derive(Deserialize)]
struct BbPage<T> {
    #[serde(default = "Vec::new")]
    values: Vec<T>,
}

impl<T> Default for BbPage<T> {
    fn default() -> Self {
        Self { values: Vec::new() }
    }
}

// ── Repository listing (clone browser) ─────────────────────────────────────────

/// The nested `workspace_base` object inside a `/2.0/user/workspaces` membership
/// wrapper (also embedded on a repo object). Only the slug is needed; the base
/// shape carries no `name` field (unlike a full workspace object), so we never
/// depend on one. `#[serde(default)]` tolerates a missing slug (skipped downstream).
#[derive(Deserialize)]
struct BbWorkspace {
    #[serde(default)]
    slug: String,
}

/// One membership entry of `GET /2.0/user/workspaces` (a `workspace_access`
/// wrapper). The `workspace` is optional/tolerant — an entry with no nested
/// workspace or an empty slug is skipped rather than erroring.
#[derive(Deserialize)]
struct BbWorkspaceAccess {
    #[serde(default)]
    workspace: Option<BbWorkspace>,
}

/// The links block on a repo object (clone URLs).
#[derive(Deserialize, Default)]
struct BbRepoLinks {
    #[serde(default, deserialize_with = "null_to_default")]
    clone: Vec<BbCloneLink>,
}

/// A repository as `GET /2.0/repositories/{workspace}` returns it.
#[derive(Deserialize)]
struct BbRepo {
    #[serde(default)]
    name: String,
    #[serde(default)]
    full_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    is_private: bool,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    updated_on: Option<String>,
    #[serde(default)]
    parent: Option<serde_json::Value>,
    #[serde(default)]
    links: Option<BbRepoLinks>,
    #[serde(default)]
    workspace: Option<BbWorkspace>,
}

fn from_bb_repo(r: BbRepo) -> ForgeRepo {
    let links = r.links.unwrap_or_default();
    let clone_url = links
        .clone
        .iter()
        .find(|c| c.name == "https")
        .map(|c| c.href.clone())
        .unwrap_or_default();
    let ssh_url = links
        .clone
        .iter()
        .find(|c| c.name == "ssh")
        .map(|c| c.href.clone())
        .unwrap_or_default();
    // Owner = the workspace slug; Bitbucket's full_name is already "workspace/slug".
    let owner = r
        .workspace
        .map(|w| w.slug)
        .filter(|s| !s.is_empty())
        .or_else(|| r.full_name.split('/').next().map(str::to_string))
        .unwrap_or_default();
    ForgeRepo {
        full_name: r.full_name,
        owner,
        name: r.name,
        private: r.is_private,
        // Bitbucket Cloud has no repository-archived concept.
        archived: false,
        fork: r.parent.is_some(),
        clone_url,
        ssh_url,
        description: r.description,
        pushed_at: r.updated_on,
    }
}

/// The signed-in user's repositories, for the clone browser. Both `GET
/// /2.0/repositories?role=member` AND `GET /2.0/workspaces` were removed (CHANGE-2770,
/// Feb 2026); the replacement is `GET /2.0/user/workspaces` (CHANGE-3022), whose items
/// are `workspace_access` membership wrappers (a nested `workspace_base` with
/// uuid/slug/links — no `name`). We list the viewer's workspaces, then each
/// workspace's member repos. Single page per call at the max `pagelen` (100),
/// mirroring GitLab's no-pagination-loop policy — the least-recently-updated repos
/// past 100/workspace drop off (they're sorted `-updated_on`). Live-verified against
/// a real account (3 workspaces, 11 repos).
pub async fn list_repos() -> AppResult<ForgeRepoList> {
    let creds = http::load_credentials().await?;
    let viewer = http::bb_get_json::<BbUser>(&creds, "user", "user")
        .await
        .ok()
        .and_then(|u| u.username.or(u.display_name))
        .unwrap_or_default();

    let workspaces: BbPage<BbWorkspaceAccess> =
        http::bb_get_json(&creds, "user/workspaces?pagelen=100", "workspaces").await?;

    let mut repos = Vec::new();
    for access in workspaces.values {
        // Skip an entry with no nested workspace or an empty slug rather than error.
        let Some(slug) = access.workspace.map(|w| w.slug).filter(|s| !s.is_empty()) else {
            continue;
        };
        let path = format!(
            "repositories/{}?role=member&sort=-updated_on&pagelen=100",
            encode_query_value(&slug)
        );
        // Best-effort per workspace: one workspace erroring (e.g. a permissions
        // quirk) shouldn't sink the whole list.
        if let Ok(page) = http::bb_get_json::<BbPage<BbRepo>>(&creds, &path, "repositories").await {
            repos.extend(page.values.into_iter().map(from_bb_repo));
        }
    }
    Ok(ForgeRepoList { viewer, repos })
}

// ── Pull requests (read) ───────────────────────────────────────────────────────

/// Map Bitbucket's PR state onto the neutral `"OPEN"/"MERGED"/"CLOSED"` the frontend
/// renders (DECLINED and SUPERSEDED both collapse to CLOSED).
fn map_bb_pr_state(state: &str) -> String {
    match state {
        "OPEN" => "OPEN".to_string(),
        "MERGED" => "MERGED".to_string(),
        "DECLINED" | "SUPERSEDED" => "CLOSED".to_string(),
        other => other.to_ascii_uppercase(),
    }
}

/// A PR branch ref (`{branch:{name}, commit:{hash}}`).
#[derive(Deserialize, Default)]
struct BbPrEndpoint {
    #[serde(default)]
    branch: Option<BbBranchRef>,
}

#[derive(Deserialize, Default)]
struct BbBranchRef {
    #[serde(default)]
    name: String,
}

/// The `links.html.href` block shared by PRs, comments, etc.
#[derive(Deserialize, Default)]
struct BbHtmlLinks {
    #[serde(default)]
    html: Option<BbLink>,
}

/// A pull request as the list/detail endpoints return it. The list payload omits
/// reviewers/participants (single-PR GET only); the fields here are the common set.
#[derive(Deserialize)]
struct BbPr {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    state: String,
    #[serde(default, deserialize_with = "null_to_default")]
    draft: bool,
    #[serde(default)]
    author: Option<BbUser>,
    #[serde(default)]
    source: Option<BbPrEndpoint>,
    #[serde(default)]
    destination: Option<BbPrEndpoint>,
    #[serde(default)]
    links: Option<BbHtmlLinks>,
}

/// Best display login for a Bitbucket user: display_name else nickname (other users
/// carry no username — only the authenticated self does).
fn user_login(u: &BbUser) -> String {
    u.display_name
        .clone()
        .or_else(|| u.nickname.clone())
        .or_else(|| u.username.clone())
        .unwrap_or_default()
}

fn branch_name(ep: &Option<BbPrEndpoint>) -> String {
    ep.as_ref()
        .and_then(|e| e.branch.as_ref())
        .map(|b| b.name.clone())
        .unwrap_or_default()
}

fn html_href(links: &Option<BbHtmlLinks>) -> String {
    links
        .as_ref()
        .and_then(|l| l.html.as_ref())
        .map(|h| h.href.clone())
        .unwrap_or_default()
}

fn from_bb_pr(p: BbPr) -> PrInfo {
    PrInfo {
        number: p.id,
        url: html_href(&p.links),
        title: p.title,
        base_ref_name: branch_name(&p.destination),
        head_ref_name: branch_name(&p.source),
        is_draft: p.draft,
        state: map_bb_pr_state(&p.state),
        author: p.author.as_ref().map(|a| PrAuthor {
            login: user_login(a),
        }),
        // Bitbucket PRs have no labels.
        labels: Vec::<PrListLabel>::new(),
    }
}

/// The `state` query fragment for a PR-list filter: `"open"` → one `state=OPEN`,
/// `"closed"` → the repeatable-param merge of MERGED/DECLINED/SUPERSEDED. Unknown
/// filters error (mirroring GitLab). Pure — validated before any I/O.
fn pr_state_filter(state: &str) -> AppResult<&'static str> {
    match state {
        "open" => Ok("state=OPEN"),
        "closed" => Ok("state=MERGED&state=DECLINED&state=SUPERSEDED"),
        other => Err(AppError::InvalidArgument(format!(
            "unknown PR state filter: {other}"
        ))),
    }
}

/// The repo's pull requests. `state` is `"open"` (→ one call `state=OPEN`) or
/// `"closed"` (→ one call merging `MERGED`/`DECLINED`/`SUPERSEDED` via the repeatable
/// `state` param). `pagelen` maxes at 50 for this endpoint. Unknown filters error.
pub async fn list_prs(repo_path: &str, state: &str) -> AppResult<Vec<PrInfo>> {
    let states = pr_state_filter(state)?;
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let path = format!(
        "repositories/{}/{}/pullrequests?{states}&pagelen=50",
        encode_query_value(&ws),
        encode_query_value(&slug),
    );
    let page: BbPage<BbPr> = http::bb_get_json(&creds, &path, "pull requests").await?;
    Ok(page.values.into_iter().map(from_bb_pr).collect())
}

/// Open PRs whose source branch is `head` — the ComparePanel duplicate probe. Uses
/// Bitbucket's BBQL query filter. Rejects an empty/`-`-leading head (mirroring
/// GitLab) and a head containing `"` or `\` (which would break the quoted BBQL
/// value — reject rather than invent escaping); the value is percent-encoded.
pub async fn prs_for_branch(repo_path: &str, head: &str) -> AppResult<Vec<PrInfo>> {
    if head.is_empty() || head.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid branch: {head}")));
    }
    if head.contains('"') || head.contains('\\') {
        return Err(AppError::InvalidArgument(format!(
            "unexpected characters in branch name: {head}"
        )));
    }
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let query = format!(r#"source.branch.name="{head}" AND state="OPEN""#);
    let path = format!(
        "repositories/{}/{}/pullrequests?q={}&pagelen=50",
        encode_query_value(&ws),
        encode_query_value(&slug),
        encode_query_value(&query),
    );
    let page: BbPage<BbPr> = http::bb_get_json(&creds, &path, "pull requests").await?;
    Ok(page.values.into_iter().map(from_bb_pr).collect())
}

/// A PR commit (`{hash, date, message, summary, author {raw, user}}`).
#[derive(Deserialize)]
struct BbCommit {
    #[serde(default)]
    hash: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    summary: Option<BbRendered>,
    #[serde(default)]
    author: Option<BbCommitAuthor>,
}

#[derive(Deserialize, Default)]
struct BbRendered {
    #[serde(default)]
    raw: String,
}

#[derive(Deserialize, Default)]
struct BbCommitAuthor {
    #[serde(default)]
    raw: String,
    #[serde(default)]
    user: Option<BbUser>,
}

/// A diffstat entry (`{status, lines_added, lines_removed, old:{path}|null, new:{path}|null}`).
#[derive(Deserialize)]
struct BbDiffstat {
    #[serde(default)]
    lines_added: u32,
    #[serde(default)]
    lines_removed: u32,
    #[serde(default)]
    old: Option<BbPathItem>,
    #[serde(default)]
    new: Option<BbPathItem>,
}

#[derive(Deserialize, Default)]
struct BbPathItem {
    #[serde(default)]
    path: String,
}

/// A PR comment (`{id, content:{raw}, user, created_on, deleted, pending, inline?}`).
#[derive(Deserialize)]
struct BbComment {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    content: Option<BbRendered>,
    #[serde(default)]
    user: Option<BbUser>,
    #[serde(default)]
    created_on: String,
    #[serde(default, deserialize_with = "null_to_default")]
    deleted: bool,
    #[serde(default, deserialize_with = "null_to_default")]
    pending: bool,
    /// Present only for inline (file) comments; general comments omit it.
    #[serde(default)]
    inline: Option<BbInline>,
    #[serde(default)]
    links: Option<BbHtmlLinks>,
}

#[derive(Deserialize, Default)]
struct BbInline {
    #[serde(default)]
    path: String,
    #[serde(default)]
    to: Option<u64>,
    #[serde(default)]
    from: Option<u64>,
}

/// A commit status (`{key, name, state, url}`).
#[derive(Deserialize)]
struct BbCommitStatus {
    #[serde(default)]
    key: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    state: String,
}

/// Map a Bitbucket commit-status state onto the vocabulary `RemotePrView`'s
/// `checkPresentation` keys on (uppercased): SUCCESS → passed, FAILURE → failed,
/// anything else → pending. Bitbucket sends SUCCESSFUL/FAILED/INPROGRESS/STOPPED.
fn map_bb_check_state(state: &str) -> String {
    match state {
        "SUCCESSFUL" => "SUCCESS".to_string(),
        "FAILED" => "FAILURE".to_string(),
        "STOPPED" => "CANCELLED".to_string(),
        // INPROGRESS (and anything unknown) → the frontend's pending bucket.
        _ => "PENDING".to_string(),
    }
}

fn commit_headline(c: &BbCommit) -> String {
    // Prefer the summary raw; else the first line of the full message.
    if let Some(s) = &c.summary {
        if !s.raw.trim().is_empty() {
            return s.raw.lines().next().unwrap_or("").trim().to_string();
        }
    }
    c.message.lines().next().unwrap_or("").trim().to_string()
}

fn commit_author(c: &BbCommit) -> String {
    c.author
        .as_ref()
        .and_then(|a| {
            a.user
                .as_ref()
                .map(user_login)
                .filter(|s| !s.is_empty())
                .or_else(|| (!a.raw.is_empty()).then(|| a.raw.clone()))
        })
        .unwrap_or_default()
}

/// Full read view of one pull request — the single PR GET (hard error) plus
/// best-effort sub-fetches (commits, diffstat, comments, statuses), mapped onto
/// `PrDetails`. Reviews are left empty: the frontend renders `reviews` generically
/// (author + body + state), but a Bitbucket "approved" participant has no body/state
/// text to show — so like GitLab's `view_pr` this returns `Vec::new()` rather than
/// bare author lines. Assignees/labels are always empty (Bitbucket has neither).
pub async fn view_pr(repo_path: &str, number: u64) -> AppResult<PrDetails> {
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let base = format!(
        "repositories/{}/{}/pullrequests/{number}",
        encode_query_value(&ws),
        encode_query_value(&slug),
    );

    // Core PR — a hard error (the view can't render without it).
    let pr: BbPr = http::bb_get_json(&creds, &base, "pull request").await?;

    // Commits — Bitbucket returns newest-first; the neutral model wants oldest-first
    // (the frontend treats the last as head), matching gitlab's reversal.
    let mut commits: Vec<PrCommitOut> = http::bb_get_json::<BbPage<BbCommit>>(
        &creds,
        &format!("{base}/commits?pagelen=100"),
        "commits",
    )
    .await
    .map(|page| {
        page.values
            .into_iter()
            .map(|c| PrCommitOut {
                headline: commit_headline(&c),
                author: commit_author(&c),
                oid: c.hash,
                date: c.date,
            })
            .collect()
    })
    .unwrap_or_default();
    commits.reverse();

    // Diffstat → files + additions/deletions totals.
    let mut additions = 0u32;
    let mut deletions = 0u32;
    let files: Vec<PrFileOut> = http::bb_get_json::<BbPage<BbDiffstat>>(
        &creds,
        &format!("{base}/diffstat?pagelen=100"),
        "diffstat",
    )
    .await
    .map(|page| {
        page.values
            .into_iter()
            .map(|d| {
                additions += d.lines_added;
                deletions += d.lines_removed;
                // Prefer the new path; fall back to old (a delete has new=null).
                let path = d
                    .new
                    .map(|p| p.path)
                    .filter(|p| !p.is_empty())
                    .or_else(|| d.old.map(|p| p.path))
                    .unwrap_or_default();
                PrFileOut {
                    path,
                    additions: d.lines_added,
                    deletions: d.lines_removed,
                }
            })
            .collect()
    })
    .unwrap_or_default();

    // Comments — drop deleted + pending; prefix inline comments with file:line so
    // the file context isn't lost in the flat conversation view.
    let comments: Vec<PrThreadOut> = http::bb_get_json::<BbPage<BbComment>>(
        &creds,
        &format!("{base}/comments?pagelen=100"),
        "comments",
    )
    .await
    .map(|page| {
        page.values
            .into_iter()
            .filter(|c| !c.deleted && !c.pending)
            .map(from_bb_comment)
            .collect()
    })
    .unwrap_or_default();

    // Statuses → checks.
    let checks = http::bb_get_json::<BbPage<BbCommitStatus>>(
        &creds,
        &format!("{base}/statuses?pagelen=100"),
        "statuses",
    )
    .await
    .map(|page| {
        page.values
            .into_iter()
            .map(|s| crate::github::pr::PrCheckOut {
                name: s.name.filter(|n| !n.is_empty()).unwrap_or(s.key),
                status: map_bb_check_state(&s.state),
            })
            .collect()
    })
    .unwrap_or_default();

    Ok(PrDetails {
        // No node ids on Bitbucket.
        id: String::new(),
        number: pr.id,
        title: pr.title,
        body: pr.description.unwrap_or_default(),
        author: pr.author.as_ref().map(user_login).unwrap_or_default(),
        state: map_bb_pr_state(&pr.state),
        is_draft: pr.draft,
        base_ref_name: branch_name(&pr.destination),
        head_ref_name: branch_name(&pr.source),
        additions,
        deletions,
        url: html_href(&pr.links),
        commits,
        files,
        reviews: Vec::new(),
        comments,
        checks,
        labels: Vec::new(),
        assignees: Vec::new(),
    })
}

/// Map one non-deleted/non-pending comment onto a neutral thread. Inline (file)
/// comments get a `**\`path\`** (line N):` prefix so the file/line context survives
/// the flat conversation view.
fn from_bb_comment(c: BbComment) -> PrThreadOut {
    let raw = c.content.map(|r| r.raw).unwrap_or_default();
    let body = match &c.inline {
        Some(inline) if !inline.path.is_empty() => {
            let line = inline.to.or(inline.from);
            match line {
                Some(n) => format!("**`{}`** (line {n}):\n\n{raw}", inline.path),
                None => format!("**`{}`**:\n\n{raw}", inline.path),
            }
        }
        _ => raw,
    };
    PrThreadOut {
        author: c.user.as_ref().map(user_login).unwrap_or_default(),
        state: String::new(),
        body,
        date: c.created_on,
        id: c.id.to_string(),
        url: html_href(&c.links),
        viewer_did_author: false,
        is_minimized: false,
        minimized_reason: String::new(),
    }
}

/// The unified diff for one PR. The `/diff` endpoint 302-redirects (same host) to
/// the raw unified diff; reqwest follows it keeping Authorization (see `http::CLIENT`).
/// Capped like the gh/gitlab paths.
pub async fn diff_pr(repo_path: &str, number: u64) -> AppResult<String> {
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let path = format!(
        "repositories/{}/{}/pullrequests/{number}/diff",
        encode_query_value(&ws),
        encode_query_value(&slug),
    );
    let diff = http::bb_get_text(&creds, &path).await?;
    let (text, _) = crate::git::diff::truncate_at_char_boundary(diff, PR_DIFF_CAP);
    Ok(text)
}

// ── Pipelines (CI, read) ───────────────────────────────────────────────────────

/// Collapse Bitbucket's pipeline/step state onto GitHub's two-field
/// `(status, conclusion)` model. `state_name` is PENDING/IN_PROGRESS/COMPLETED;
/// `result_name` (present when COMPLETED) is SUCCESSFUL/FAILED/ERROR/STOPPED.
fn map_bb_pipeline_status(state_name: &str, result_name: &str) -> (String, String) {
    let (status, conclusion) = match state_name {
        "COMPLETED" => match result_name {
            "SUCCESSFUL" => ("completed", "success"),
            "FAILED" => ("completed", "failure"),
            "ERROR" => ("completed", "failure"),
            "STOPPED" => ("completed", "cancelled"),
            // COMPLETED with a missing/unknown result — finished, neutral.
            _ => ("completed", ""),
        },
        "IN_PROGRESS" => ("in_progress", ""),
        "PENDING" => ("queued", ""),
        // Unknown/new Bitbucket state — treat as finished-neutral rather than guess.
        _ => ("completed", ""),
    };
    (status.to_string(), conclusion.to_string())
}

/// Bitbucket's pipeline trigger → a short label for the run's "workflow" slot.
fn friendly_trigger(name: &str) -> String {
    match name {
        "PUSH" => "Push",
        "MANUAL" => "Manual",
        "SCHEDULED" => "Scheduled",
        "PARENT_STEP" => "Parent step",
        "" => "Pipeline",
        other => other,
    }
    .to_string()
}

#[derive(Deserialize, Default)]
struct BbState {
    #[serde(default)]
    name: String,
    #[serde(default)]
    result: Option<BbNamed>,
}

#[derive(Deserialize, Default)]
struct BbNamed {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize, Default)]
struct BbTarget {
    #[serde(default)]
    ref_name: Option<String>,
    #[serde(default)]
    commit: Option<BbCommitRef>,
}

#[derive(Deserialize, Default)]
struct BbCommitRef {
    #[serde(default)]
    hash: String,
}

/// A pipeline as `GET …/pipelines/` returns it.
#[derive(Deserialize)]
struct BbPipeline {
    #[serde(default)]
    uuid: String,
    #[serde(default)]
    build_number: u64,
    #[serde(default)]
    state: Option<BbState>,
    #[serde(default)]
    target: Option<BbTarget>,
    #[serde(default)]
    trigger: Option<BbNamed>,
    #[serde(default)]
    created_on: String,
    #[serde(default)]
    completed_on: Option<String>,
}

/// The state/result names of a pipeline or step (helper for the mapper).
fn state_and_result(state: &Option<BbState>) -> (String, String) {
    match state {
        Some(s) => (
            s.name.clone(),
            s.result
                .as_ref()
                .map(|r| r.name.clone())
                .unwrap_or_default(),
        ),
        None => (String::new(), String::new()),
    }
}

fn pipeline_url(ws: &str, slug: &str, build_number: u64) -> String {
    format!("https://bitbucket.org/{ws}/{slug}/pipelines/results/{build_number}")
}

fn from_bb_pipeline(p: BbPipeline, ws: &str, slug: &str) -> WorkflowRun {
    let (state_name, result_name) = state_and_result(&p.state);
    let (status, conclusion) = map_bb_pipeline_status(&state_name, &result_name);
    let ref_name = p
        .target
        .as_ref()
        .and_then(|t| t.ref_name.clone())
        .filter(|s| !s.is_empty());
    let head_sha = p
        .target
        .as_ref()
        .and_then(|t| t.commit.as_ref())
        .map(|c| c.hash.clone())
        .unwrap_or_default();
    let trigger = p.trigger.map(|t| t.name).unwrap_or_default();
    let display_title = ref_name
        .clone()
        .map(|r| format!("Pipeline #{} · {r}", p.build_number))
        .unwrap_or_else(|| format!("Pipeline #{}", p.build_number));
    WorkflowRun {
        id: p.build_number,
        number: p.build_number,
        display_title,
        status,
        conclusion,
        workflow_name: friendly_trigger(&trigger),
        head_branch: ref_name.unwrap_or_default(),
        event: trigger.to_ascii_lowercase(),
        created_at: p.created_on.clone(),
        // Never leave started_at empty — Insights filters on it (same rule as gitlab).
        started_at: p.created_on.clone(),
        updated_at: p
            .completed_on
            .filter(|s| !s.is_empty())
            .unwrap_or(p.created_on),
        url: pipeline_url(ws, slug, p.build_number),
        head_sha,
    }
}

/// Recent pipelines for this repo, newest first; optionally scoped to one branch.
/// Note the TRAILING SLASH on `pipelines/` (required). Single page at `pagelen =
/// limit.clamp(1,100)`, matching GitLab's no-loop policy.
pub async fn list_runs(
    repo_path: &str,
    limit: u32,
    branch: Option<String>,
) -> AppResult<Vec<WorkflowRun>> {
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let per_page = limit.clamp(1, 100);
    let mut path = format!(
        "repositories/{}/{}/pipelines/?sort=-created_on&pagelen={per_page}",
        encode_query_value(&ws),
        encode_query_value(&slug),
    );
    if let Some(b) = branch.as_deref().filter(|s| !s.is_empty()) {
        path.push_str(&format!("&target.branch={}", encode_query_value(b)));
    }
    let page: BbPage<BbPipeline> = http::bb_get_json(&creds, &path, "pipelines").await?;
    Ok(page
        .values
        .into_iter()
        .map(|p| from_bb_pipeline(p, &ws, &slug))
        .collect())
}

/// A pipeline step (`{uuid, name?, state{name, result{name}}, …}`). No numeric id.
#[derive(Deserialize)]
struct BbStep {
    #[serde(default)]
    uuid: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    state: Option<BbState>,
    #[serde(default, deserialize_with = "null_to_default")]
    started_on: String,
    #[serde(default, deserialize_with = "null_to_default")]
    completed_on: String,
}

/// Percent-encode a braced pipeline/step UUID for use in a path segment. Literal
/// braces 400; `{`→`%7B`, `}`→`%7D` (and any other reserved byte encoded too).
fn encode_uuid(uuid: &str) -> String {
    let mut out = String::with_capacity(uuid.len() + 6);
    for b in uuid.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Resolve one pipeline by build number: primary `GET …/pipelines/{n}`, with a
/// fallback to `GET …/pipelines/?q=build_number={n}` (taking the single value) if
/// the primary 404s. Both paths are written per the spec — live validation confirms
/// which sticks.
async fn resolve_pipeline(
    creds: &BbCredentials,
    ws: &str,
    slug: &str,
    build_number: u64,
) -> AppResult<BbPipeline> {
    let ws_e = encode_query_value(ws);
    let slug_e = encode_query_value(slug);
    let primary = format!("repositories/{ws_e}/{slug_e}/pipelines/{build_number}");
    match http::bb_get_json::<BbPipeline>(creds, &primary, "pipeline").await {
        Ok(p) => Ok(p),
        Err(AppError::Bitbucket(_)) => {
            // Fallback: query by build_number and take the single match.
            let q = format!(
                "repositories/{ws_e}/{slug_e}/pipelines/?q=build_number={build_number}&pagelen=1"
            );
            let page: BbPage<BbPipeline> = http::bb_get_json(creds, &q, "pipeline").await?;
            page.values.into_iter().next().ok_or_else(|| {
                AppError::Bitbucket(format!(
                    "no Bitbucket pipeline with build number {build_number}"
                ))
            })
        }
        Err(e) => Err(e),
    }
}

/// The pipeline's steps (`GET …/pipelines/{uuid}/steps/`). Braced UUID percent-encoded.
async fn pipeline_steps(creds: &BbCredentials, ws: &str, slug: &str, uuid: &str) -> Vec<BbStep> {
    let path = format!(
        "repositories/{}/{}/pipelines/{}/steps/?pagelen=100",
        encode_query_value(ws),
        encode_query_value(slug),
        encode_uuid(uuid),
    );
    http::bb_get_json::<BbPage<BbStep>>(creds, &path, "steps")
        .await
        .map(|p| p.values)
        .unwrap_or_default()
}

fn from_bb_step(index: usize, s: BbStep, pipeline_uuid: &str, url: &str) -> RunJob {
    let (state_name, result_name) = state_and_result(&s.state);
    let (status, conclusion) = map_bb_pipeline_status(&state_name, &result_name);
    let name = s
        .name
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("Step {}", index + 1));
    RunJob {
        // Synthetic — Bitbucket steps have no numeric id; this is only a UI key.
        id: (index + 1) as u64,
        name,
        status,
        conclusion,
        started_at: s.started_on,
        completed_at: s.completed_on,
        url: url.to_string(),
        steps: Vec::new(),
        // The real handle for fetching this step's log (raw braced UUIDs).
        log_ref: Some(format!("{pipeline_uuid}/{}", s.uuid)),
    }
}

/// One pipeline with its steps mapped onto `RunDetail`.
pub async fn view_run(repo_path: &str, run_id: u64) -> AppResult<RunDetail> {
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let p = resolve_pipeline(&creds, &ws, &slug, run_id).await?;
    let uuid = p.uuid.clone();
    let (state_name, result_name) = state_and_result(&p.state);
    let (status, conclusion) = map_bb_pipeline_status(&state_name, &result_name);
    let ref_name = p
        .target
        .as_ref()
        .and_then(|t| t.ref_name.clone())
        .filter(|s| !s.is_empty());
    let head_sha = p
        .target
        .as_ref()
        .and_then(|t| t.commit.as_ref())
        .map(|c| c.hash.clone())
        .unwrap_or_default();
    let trigger = p.trigger.map(|t| t.name).unwrap_or_default();
    let url = pipeline_url(&ws, &slug, run_id);
    let display_title = ref_name
        .clone()
        .map(|r| format!("Pipeline #{run_id} · {r}"))
        .unwrap_or_else(|| format!("Pipeline #{run_id}"));

    let steps = pipeline_steps(&creds, &ws, &slug, &uuid).await;
    let jobs = steps
        .into_iter()
        .enumerate()
        .map(|(i, s)| from_bb_step(i, s, &uuid, &url))
        .collect();

    Ok(RunDetail {
        id: run_id,
        number: run_id,
        display_title,
        status,
        conclusion,
        workflow_name: friendly_trigger(&trigger),
        head_branch: ref_name.unwrap_or_default(),
        event: trigger.to_ascii_lowercase(),
        created_at: p.created_on,
        url,
        head_sha,
        jobs,
    })
}

/// Keep at most `cap` bytes, preferring the tail (CI failures land at the end), on a
/// char boundary. Mirrors the gitlab/gh log truncation.
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

/// Shown when a step's log has aged out — Bitbucket expires older pipeline logs, at
/// which point the log endpoint returns a plain 404 (no redirect). This is a normal
/// state for old pipelines, not an error, so it reads as informative text.
const EXPIRED_LOG_MESSAGE: &str =
    "Logs for this step are no longer available — Bitbucket expires older pipeline logs.";

/// Fetch one step's log via `log_ref` (`"{pipeline_uuid}/{step_uuid}"`, RAW braces).
/// The `…/steps/{uuid}/log` endpoint 307-redirects (cross-host) to a pre-signed S3
/// URL; reqwest strips Authorization on that hop (see `http::CLIENT`). Cleaned/capped
/// like the gitlab job log (60_000 chars; empty → placeholder).
///
/// A 404 means the log has EXPIRED (verified live on a 2024 pipeline — Bitbucket
/// prunes old logs) — a normal state, so it returns the informative
/// [`EXPIRED_LOG_MESSAGE`] as `Ok` rather than surfacing a raw error toast. Any other
/// non-2xx still errors via `http::http_error` (401/429 special-casing preserved).
pub async fn step_logs(repo_path: &str, log_ref: &str) -> AppResult<String> {
    let (pipeline_uuid, step_uuid) = log_ref
        .split_once('/')
        .ok_or_else(|| AppError::InvalidArgument("a step log reference is required".into()))?;
    if pipeline_uuid.is_empty() || step_uuid.is_empty() {
        return Err(AppError::InvalidArgument(
            "a step log reference is required".into(),
        ));
    }
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let path = format!(
        "repositories/{}/{}/pipelines/{}/steps/{}/log",
        encode_query_value(&ws),
        encode_query_value(&slug),
        encode_uuid(pipeline_uuid),
        encode_uuid(step_uuid),
    );
    let (status, body) = http::bb_get_text_status(&creds, &path).await?;
    if status == 404 {
        return Ok(EXPIRED_LOG_MESSAGE.to_string());
    }
    if !(200..300).contains(&status) {
        return Err(http::http_error(status, &body));
    }
    let text = if body.trim().is_empty() {
        "This step produced no log output.".to_string()
    } else {
        body
    };
    Ok(tail_cap(text, CI_STEP_LOG_CAP))
}

/// The failed steps' logs for a pipeline, concatenated — Bitbucket's analogue of
/// `gh run view --log-failed`. Resolves the pipeline, lists steps, fetches the log of
/// each step whose result is FAILED/ERROR, with `===== {name} =====` separators.
pub async fn run_failed_logs(repo_path: &str, run_id: u64) -> AppResult<String> {
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let p = resolve_pipeline(&creds, &ws, &slug, run_id).await?;
    let uuid = p.uuid.clone();
    let steps = pipeline_steps(&creds, &ws, &slug, &uuid).await;
    let failed: Vec<&BbStep> = steps
        .iter()
        .filter(|s| {
            let (_, result) = state_and_result(&s.state);
            result == "FAILED" || result == "ERROR"
        })
        .collect();
    if failed.is_empty() {
        return Ok("No failed steps in this pipeline.".to_string());
    }
    let mut text = String::new();
    for (i, step) in steps.iter().enumerate() {
        let (_, result) = state_and_result(&step.state);
        if result != "FAILED" && result != "ERROR" {
            continue;
        }
        if text.len() > CI_RUN_LOG_CAP {
            break;
        }
        let name = step
            .name
            .clone()
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| format!("Step {}", i + 1));
        let log_ref = format!("{uuid}/{}", step.uuid);
        // An expired log comes back as the placeholder message (Ok), a hard failure
        // as an Err — either way make the section say so rather than leave a bare
        // header with an empty body in the concatenated output.
        let log = match step_logs(repo_path, &log_ref).await {
            Ok(l) if l == EXPIRED_LOG_MESSAGE => "(log unavailable — expired)".to_string(),
            Ok(l) if l.trim().is_empty() => "(log unavailable)".to_string(),
            Ok(l) => l,
            Err(_) => "(log unavailable)".to_string(),
        };
        text.push_str(&format!("===== {name} =====\n"));
        text.push_str(log.trim_end());
        text.push_str("\n\n");
    }
    Ok(tail_cap(text, CI_RUN_LOG_CAP))
}

/// The repo's web URL for "View on Bitbucket".
pub async fn repo_url(repo_path: &str) -> AppResult<String> {
    let (ws, slug) = workspace_slug(repo_path).await?;
    Ok(format!("https://bitbucket.org/{ws}/{slug}"))
}

// ── Pull requests (write) ───────────────────────────────────────────────────────

/// The `repositories/{ws}/{slug}` path prefix every write shares — resolve the
/// workspace/slug from the origin remote and percent-encode both segments.
async fn repo_base(repo_path: &str) -> AppResult<String> {
    let (ws, slug) = workspace_slug(repo_path).await?;
    Ok(format!(
        "repositories/{}/{}",
        encode_query_value(&ws),
        encode_query_value(&slug),
    ))
}

/// Post a comment on a pull request (`POST …/pullrequests/{n}/comments`,
/// `{"content":{"raw": body}}`). The created comment is ignored — the frontend
/// refetches the thread.
pub async fn comment_pr(repo_path: &str, number: u64, body: &str) -> AppResult<()> {
    let creds = http::load_credentials().await?;
    let base = repo_base(repo_path).await?;
    let path = format!("{base}/pullrequests/{number}/comments");
    let payload = serde_json::json!({ "content": { "raw": body } });
    http::bb_post_json::<serde_json::Value>(&creds, &path, &payload, "comment").await?;
    Ok(())
}

/// Decline (close) a pull request (`POST …/pullrequests/{n}/decline`, no body). A
/// declined Bitbucket PR CANNOT be reopened (via API or web — BCLOUD-4954), so there
/// is no reopen counterpart; `forge_pr_reopen` errors for Bitbucket by design.
pub async fn decline_pr(repo_path: &str, number: u64) -> AppResult<()> {
    let creds = http::load_credentials().await?;
    let base = repo_base(repo_path).await?;
    let path = format!("{base}/pullrequests/{number}/decline");
    http::bb_post_empty(&creds, &path).await
}

/// Map the neutral merge-strategy string onto Bitbucket's `merge_strategy` enum.
/// Pure (testable). Unknown strategies error rather than silently defaulting.
fn map_merge_strategy(strategy: &str) -> AppResult<&'static str> {
    match strategy {
        "merge" => Ok("merge_commit"),
        "squash" => Ok("squash"),
        "fast_forward" => Ok("fast_forward"),
        other => Err(AppError::InvalidArgument(format!(
            "unsupported Bitbucket merge strategy: {other}"
        ))),
    }
}

/// The `{task_status}` envelope of a merge poll (`GET {location}`).
#[derive(Deserialize)]
struct BbMergeTask {
    #[serde(default)]
    task_status: String,
}

/// Merge a pull request (`POST …/pullrequests/{n}/merge`). Bitbucket has no
/// expected-hash guard (the caller's `sha` is dropped upstream). The body is
/// `{"type":"pullrequest","merge_strategy":<mapped>,"close_source_branch": delete}` —
/// `close_source_branch:true` auto-deletes the source branch.
///
/// Small repos merge SYNCHRONOUSLY (200); large/slow merges return 202 with a
/// `Location` task-status URL we poll until `SUCCESS`. Any other status → an error via
/// [`http::http_error`] (an already-closed PR surfaces as its 400 "This pull request is
/// already closed.").
pub async fn merge_pr(
    repo_path: &str,
    number: u64,
    strategy: &str,
    delete_branch: bool,
) -> AppResult<()> {
    let merge_strategy = map_merge_strategy(strategy)?;
    let creds = http::load_credentials().await?;
    let base = repo_base(repo_path).await?;
    let path = format!("{base}/pullrequests/{number}/merge");
    let payload = serde_json::json!({
        "type": "pullrequest",
        "merge_strategy": merge_strategy,
        "close_source_branch": delete_branch,
    });
    let (status, location, body) =
        http::bb_send(&creds, reqwest::Method::POST, &path, Some(&payload)).await?;
    match status {
        // Synchronous merge — done.
        200 => Ok(()),
        // Asynchronous merge — poll the task-status URL from the Location header.
        202 => {
            let task_url = location.filter(|l| !l.is_empty()).ok_or_else(|| {
                AppError::Bitbucket(
                    "Bitbucket accepted the merge but returned no task-status URL to poll.".into(),
                )
            })?;
            poll_merge_task(&creds, &task_url).await
        }
        _ => Err(http::http_error(status, &body)),
    }
}

/// Poll a Bitbucket merge task-status URL until it resolves. `PENDING` loops (bounded
/// to ~30 tries, 2s apart); `SUCCESS` → Ok; anything else → an error carrying the raw
/// body. A non-2xx poll response errors via [`http::http_error`].
async fn poll_merge_task(creds: &BbCredentials, task_url: &str) -> AppResult<()> {
    for _ in 0..30 {
        let (status, _, body) = http::bb_send(creds, reqwest::Method::GET, task_url, None).await?;
        if !(200..300).contains(&status) {
            return Err(http::http_error(status, &body));
        }
        let task: BbMergeTask = serde_json::from_str(&body).map_err(|e| {
            AppError::Bitbucket(format!("could not parse Bitbucket merge status: {e}"))
        })?;
        match task.task_status.as_str() {
            "SUCCESS" => return Ok(()),
            "PENDING" | "" => {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
            other => {
                return Err(AppError::Bitbucket(format!(
                    "Bitbucket merge did not complete (task status: {other})."
                )));
            }
        }
    }
    Err(AppError::Bitbucket(
        "Bitbucket merge is still processing — check the pull request on Bitbucket.".into(),
    ))
}

/// A minimal PR shape for the edit read-back — just the reviewer uuids we must echo.
#[derive(Deserialize, Default)]
struct BbPrReviewers {
    #[serde(default, deserialize_with = "null_to_default")]
    reviewers: Vec<BbReviewer>,
}

#[derive(Deserialize, Default)]
struct BbReviewer {
    #[serde(default)]
    uuid: String,
}

/// Build the reviewer-safe edit body: title + description + the existing reviewer
/// uuids. Pure (testable). Omitting `reviewers` from a Bitbucket PR PUT WIPES them
/// (Renovate-confirmed), so we always echo the existing set.
fn build_edit_body(title: &str, body: &str, reviewer_uuids: &[String]) -> serde_json::Value {
    let reviewers: Vec<serde_json::Value> = reviewer_uuids
        .iter()
        .map(|u| serde_json::json!({ "uuid": u }))
        .collect();
    serde_json::json!({
        "title": title,
        "description": body,
        "reviewers": reviewers,
    })
}

/// Edit a pull request's title/body (`PUT …/pullrequests/{n}`). Only OPEN PRs are
/// mutable. A Bitbucket PR PUT that omits `reviewers` WIPES them, so we first read the
/// existing reviewer uuids and echo them back alongside the new title/description.
pub async fn edit_pr(repo_path: &str, number: u64, title: &str, body: &str) -> AppResult<()> {
    let creds = http::load_credentials().await?;
    let base = repo_base(repo_path).await?;
    // Read the current reviewers (uuid only) so the PUT preserves them.
    let read_path = format!("{base}/pullrequests/{number}?fields=reviewers.uuid");
    let existing: BbPrReviewers =
        http::bb_get_json(&creds, &read_path, "pull request reviewers").await?;
    let uuids: Vec<String> = existing
        .reviewers
        .into_iter()
        .map(|r| r.uuid)
        .filter(|u| !u.is_empty())
        .collect();
    let payload = build_edit_body(title, body, &uuids);
    let path = format!("{base}/pullrequests/{number}");
    http::bb_put_json::<serde_json::Value>(&creds, &path, &payload, "pull request").await?;
    Ok(())
}

/// A newly-created PR's identity (id + web link), for mapping onto [`PrRef`].
#[derive(Deserialize)]
struct BbCreatedPr {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    links: Option<BbHtmlLinks>,
}

/// Build the create-PR body. Pure (testable). No reviewers in v1.
fn build_create_body(base: &str, head: &str, title: &str, body: &str, draft: bool) -> serde_json::Value {
    serde_json::json!({
        "title": title,
        "description": body,
        "source": { "branch": { "name": head } },
        "destination": { "branch": { "name": base } },
        "draft": draft,
    })
}

/// Find an existing OPEN PR from `head` into `base` in a candidate list. Pure
/// (testable). `prs_for_branch` already filters to `source.branch.name == head` AND
/// `state == OPEN`, but does NOT constrain the destination, so we filter on
/// `base_ref_name == base` here to catch only a genuine same-source→same-dest
/// duplicate. Returns the matching PR's number, if any.
fn duplicate_pr_number(open_prs: &[PrInfo], base: &str) -> Option<u64> {
    open_prs
        .iter()
        .find(|p| p.base_ref_name == base)
        .map(|p| p.number)
}

/// Push `head` to origin, then open a pull request from `head` into `base`. Mirrors
/// `gitlab::create_mr`, with two Bitbucket-specific differences:
///
///  - **Duplicate is an UPSERT, so we pre-check.** A Bitbucket create POST for a
///    source→dest pair that already has an OPEN PR returns 201 with the EXISTING PR
///    but ALSO applies the payload (title overwritten, an omitted description wiped to
///    ""). So BEFORE any mutation we read the open PRs from `head` (via the same query
///    `prs_for_branch` uses) and, if one already targets `base`, error out naming its
///    number — nothing is pushed or changed.
///  - **No credential config on the push.** Unlike glab (whose token isn't in git's
///    store, so it injects a one-shot helper), Bitbucket repos in this app are
///    cloned/pushed with the user's ambient git credentials (GCM), so a plain
///    `git push origin <head>` works. The keyring token is NEVER put on argv / env /
///    git config of the push process.
///
/// Order: duplicate pre-check (read-only) → validate → push → POST create. If the POST
/// fails after a successful push, the error discloses the partial state (the branch was
/// pushed) — the same pre-mutation-guard discipline as the rest of the codebase.
pub async fn create_pr(
    state: &crate::state::AppState,
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
        return Err(AppError::InvalidArgument("a PR title is required".into()));
    }

    // Pre-mutation guard: a duplicate create is a silent overwrite on Bitbucket, so
    // refuse it before pushing or POSTing anything.
    let open_prs = prs_for_branch(repo_path, head).await?;
    if let Some(n) = duplicate_pr_number(&open_prs, base) {
        return Err(AppError::Bitbucket(format!(
            "Pull request #{n} already exists for {head} → {base} — creating another would \
             silently overwrite it, so nothing was changed. Open PR #{n} instead."
        )));
    }

    // A PR needs the branch on the remote first. Bitbucket uses the user's ambient git
    // credentials (GCM) — no token-derived credential helper, so the keyring token
    // never reaches the git process.
    crate::git::runner::run_git_mutating(
        state,
        repo_path,
        &["push", "-u", "origin", head],
        crate::git::runner::NETWORK_TIMEOUT,
    )
    .await?;

    let creds = http::load_credentials().await?;
    let repo = repo_base(repo_path).await?;
    let path = format!("{repo}/pullrequests");
    let payload = build_create_body(base, head, title, body, draft);
    let created: BbCreatedPr = http::bb_post_json(&creds, &path, &payload, "created pull request")
        .await
        .map_err(|e| {
            // The branch is already on the remote; disclose that partial state so the
            // user knows a retry needn't re-push (and the branch isn't orphaned silently).
            AppError::Bitbucket(format!("The branch was pushed, but creating the pull request failed: {e}"))
        })?;
    Ok(PrRef {
        number: created.id,
        url: html_href(&created.links),
    })
}

/// Approve a pull request (`POST …/pullrequests/{n}/approve`, no body). The author CAN
/// self-approve on Bitbucket.
pub async fn approve_pr(repo_path: &str, number: u64) -> AppResult<()> {
    let creds = http::load_credentials().await?;
    let base = repo_base(repo_path).await?;
    let path = format!("{base}/pullrequests/{number}/approve");
    http::bb_post_empty(&creds, &path).await
}

/// Revoke the viewer's approval (`DELETE …/pullrequests/{n}/approve`). Unapproving a
/// MERGED PR is rejected server-side (400 CANNOT_UNAPPROVED_MERGED_PR), surfacing via
/// [`http::http_error`].
pub async fn unapprove_pr(repo_path: &str, number: u64) -> AppResult<()> {
    let creds = http::load_credentials().await?;
    let base = repo_base(repo_path).await?;
    let path = format!("{base}/pullrequests/{number}/approve");
    http::bb_delete(&creds, &path).await
}

/// A PR participant (`{user, approved, state}`) — the approval read source. `state` is
/// `"approved"` / `"changes_requested"` / null.
#[derive(Deserialize, Default)]
struct BbParticipant {
    #[serde(default)]
    user: Option<BbUser>,
    #[serde(default, deserialize_with = "null_to_default")]
    approved: bool,
    #[serde(default)]
    state: Option<String>,
}

/// The participants block on a single-PR GET (for the approvals read).
#[derive(Deserialize, Default)]
struct BbPrParticipants {
    #[serde(default, deserialize_with = "null_to_default")]
    participants: Vec<BbParticipant>,
}

/// A human-readable display name for a PR participant: nickname → display_name →
/// username (participant user objects carry no `username`, so in practice this is the
/// nickname, then display_name). Used for the names of OTHER participants in
/// `approved_by`; the viewer's own entry is derived differently (see
/// [`build_approval_state`]).
fn participant_login(u: &BbUser) -> String {
    u.nickname
        .clone()
        .or_else(|| u.display_name.clone())
        .or_else(|| u.username.clone())
        .unwrap_or_default()
}

/// Build the neutral [`ApprovalState`] from a PR's participants, matching the viewer by
/// UUID. Pure (testable).
///
/// The viewer is matched on `participant.user.uuid == viewer_uuid`, NOT a name string:
/// participant user objects never carry `username` (privacy — only the self object
/// does), so a name match would silently fail whenever the viewer's nickname differs
/// from their username. `viewer_has_approved` / `viewer_requested_changes` come from
/// the matched participant.
///
/// `approved_by` mixes two derivations on purpose: OTHER approvers get their
/// human-readable [`participant_login`] (nickname-first), but the VIEWER's own entry
/// emits `viewer_login` — exactly the string `status().login` produces
/// (`username || display_name`), which is what the frontend's `forge.data.login`
/// carries and what its optimistic add/remove inserts into `approvedBy`. Emitting that
/// same string here lets the viewer's entry reconcile across the optimistic window
/// (otherwise the server-truth refetch would show a different string than the
/// optimistic insert and the row would flicker/duplicate).
///
/// Bitbucket exposes no required-approval count here (that's a repo-settings merge
/// check), so `approvals_required`/`_left` are 0.
fn build_approval_state(
    participants: &[BbParticipant],
    viewer_uuid: &str,
    viewer_login: &str,
) -> ApprovalState {
    let is_viewer = |u: &BbUser| -> bool {
        !viewer_uuid.is_empty() && u.uuid.as_deref() == Some(viewer_uuid)
    };
    let approved_by: Vec<String> = participants
        .iter()
        .filter(|p| p.approved)
        .filter_map(|p| {
            p.user.as_ref().map(|u| {
                if is_viewer(u) {
                    viewer_login.to_string()
                } else {
                    participant_login(u)
                }
            })
        })
        .filter(|n| !n.is_empty())
        .collect();
    let viewer = participants
        .iter()
        .find(|p| p.user.as_ref().map(is_viewer).unwrap_or(false));
    let viewer_has_approved = viewer.map(|p| p.approved).unwrap_or(false);
    let viewer_requested_changes = viewer
        .and_then(|p| p.state.as_deref())
        .map(|s| s == "changes_requested")
        .unwrap_or(false);
    ApprovalState {
        viewer_has_approved,
        approved_by,
        approvals_required: 0,
        approvals_left: 0,
        viewer_requested_changes,
    }
}

/// The viewer's + the PR's approval state (`GET …/pullrequests/{n}` participants). The
/// viewer is resolved by a one-time `GET /2.0/user` (its braced `uuid` — the only
/// identity field present on both the self object and participant objects), then
/// matched against participants by UUID. The viewer's `approved_by` entry uses the
/// stored username (falling back to the self object's display name) so it equals
/// `status().login` and reconciles with the frontend's optimistic toggle.
pub async fn pr_approvals(repo_path: &str, number: u64) -> AppResult<ApprovalState> {
    let creds = http::load_credentials().await?;
    let base = repo_base(repo_path).await?;
    let path = format!("{base}/pullrequests/{number}?fields=participants.user.uuid,participants.user.nickname,participants.user.display_name,participants.approved,participants.state");
    let pr: BbPrParticipants = http::bb_get_json(&creds, &path, "pull request participants").await?;

    // Resolve the viewer's uuid (for matching) and login (for the reconciling
    // approved_by entry) from the self object — one GET, like GitLab's approvals read.
    let self_user = http::bb_get_json::<BbUser>(&creds, "user", "user").await.ok();
    let viewer_uuid = self_user
        .as_ref()
        .and_then(|u| u.uuid.clone())
        .unwrap_or_default();
    // `status().login` = username || display_name; the stored username is the same
    // value persisted at connect time, so prefer it and fall back to the self object.
    let viewer_login = read_stored_username().await.unwrap_or_else(|| {
        self_user
            .as_ref()
            .and_then(|u| u.username.clone().or_else(|| u.display_name.clone()))
            .unwrap_or_default()
    });
    Ok(build_approval_state(&pr.participants, &viewer_uuid, &viewer_login))
}

// ── Pipelines (CI, write) ───────────────────────────────────────────────────────

/// Build the pipeline-trigger body for a branch, with optional variables. Pure
/// (testable). A non-empty `inputs` map adds a top-level `variables` array (sibling of
/// `target`); an empty map omits it entirely.
fn build_trigger_body(
    git_ref: &str,
    inputs: &std::collections::HashMap<String, String>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "target": {
            "type": "pipeline_ref_target",
            "ref_type": "branch",
            "ref_name": git_ref,
        }
    });
    if !inputs.is_empty() {
        // Sort by key for a deterministic body (stable tests + reproducible requests).
        let mut keys: Vec<&String> = inputs.keys().collect();
        keys.sort();
        let variables: Vec<serde_json::Value> = keys
            .into_iter()
            .map(|k| serde_json::json!({ "key": k, "value": inputs[k] }))
            .collect();
        body["variables"] = serde_json::Value::Array(variables);
    }
    body
}

/// Cancel an in-flight pipeline (`POST …/pipelines/{uuid}/stopPipeline`). `run_id` is
/// the build number, resolved to the pipeline UUID first (reusing the read-side
/// resolution). A 400 "already completed" surfaces via [`http::http_error`].
pub async fn cancel_run(repo_path: &str, run_id: u64) -> AppResult<()> {
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let p = resolve_pipeline(&creds, &ws, &slug, run_id).await?;
    let path = format!(
        "repositories/{}/{}/pipelines/{}/stopPipeline",
        encode_query_value(&ws),
        encode_query_value(&slug),
        encode_uuid(&p.uuid),
    );
    http::bb_post_empty(&creds, &path).await
}

/// Re-run a finished pipeline. Bitbucket has no rerun endpoint, so "re-run" re-triggers
/// a fresh pipeline on the original run's branch (`run_id` is the build number →
/// resolve → its `target.ref_name` → trigger). The new pipeline is returned but ignored.
pub async fn rerun_run(repo_path: &str, run_id: u64) -> AppResult<()> {
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let p = resolve_pipeline(&creds, &ws, &slug, run_id).await?;
    let branch = p
        .target
        .as_ref()
        .and_then(|t| t.ref_name.clone())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Bitbucket(format!(
                "could not determine the branch of Bitbucket pipeline #{run_id} to re-run"
            ))
        })?;
    let path = format!(
        "repositories/{}/{}/pipelines/",
        encode_query_value(&ws),
        encode_query_value(&slug),
    );
    let payload = build_trigger_body(&branch, &std::collections::HashMap::new());
    http::bb_post_json::<serde_json::Value>(&creds, &path, &payload, "pipeline").await?;
    Ok(())
}

/// Manually start a pipeline on `git_ref` (`POST …/pipelines/`), with `inputs` as
/// pipeline variables. Bitbucket triggers a branch pipeline (there's no per-workflow
/// dispatch — `workflow` is dropped upstream). A 400 (pipelines disabled / missing yml
/// / invalid) surfaces its raw message via [`http::http_error`].
pub async fn dispatch_ci(
    repo_path: &str,
    git_ref: &str,
    inputs: &std::collections::HashMap<String, String>,
) -> AppResult<()> {
    if git_ref.is_empty() || git_ref.starts_with('-') {
        return Err(AppError::InvalidArgument(format!(
            "invalid branch: {git_ref}"
        )));
    }
    let creds = http::load_credentials().await?;
    let (ws, slug) = workspace_slug(repo_path).await?;
    let path = format!(
        "repositories/{}/{}/pipelines/",
        encode_query_value(&ws),
        encode_query_value(&slug),
    );
    let payload = build_trigger_body(git_ref, inputs);
    http::bb_post_json::<serde_json::Value>(&creds, &path, &payload, "pipeline").await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pr(json: &str) -> PrInfo {
        from_bb_pr(serde_json::from_str(json).expect("PR should parse"))
    }

    #[test]
    fn pr_list_item_maps_to_pr_info_with_draft_and_branches() {
        let p = pr(r#"{
                "id": 42,
                "title": "Add feature",
                "state": "OPEN",
                "draft": true,
                "author": {"display_name": "Ada Lovelace", "nickname": "ada"},
                "source": {"branch": {"name": "feature/x"}},
                "destination": {"branch": {"name": "main"}},
                "links": {"html": {"href": "https://bitbucket.org/ws/repo/pull-requests/42"}}
            }"#);
        assert_eq!(p.number, 42);
        assert_eq!(p.state, "OPEN");
        assert!(p.is_draft);
        assert_eq!(p.head_ref_name, "feature/x");
        assert_eq!(p.base_ref_name, "main");
        assert_eq!(p.author.unwrap().login, "Ada Lovelace");
        assert_eq!(p.url, "https://bitbucket.org/ws/repo/pull-requests/42");
        assert!(p.labels.is_empty());
    }

    #[test]
    fn pr_state_maps_all_four_bitbucket_states() {
        assert_eq!(map_bb_pr_state("OPEN"), "OPEN");
        assert_eq!(map_bb_pr_state("MERGED"), "MERGED");
        assert_eq!(map_bb_pr_state("DECLINED"), "CLOSED");
        assert_eq!(map_bb_pr_state("SUPERSEDED"), "CLOSED");
        // Unknown → uppercased passthrough.
        assert_eq!(map_bb_pr_state("weird"), "WEIRD");
    }

    #[test]
    fn pr_tolerates_null_merge_commit_author_and_description() {
        // A minimal declined PR with a null author and no description.
        let p = pr(r#"{
                "id": 7,
                "title": "Old",
                "state": "DECLINED",
                "author": null,
                "description": null,
                "merge_commit": null,
                "source": {"branch": {"name": "old"}},
                "destination": {"branch": {"name": "main"}}
            }"#);
        assert_eq!(p.state, "CLOSED");
        assert!(!p.is_draft);
        assert!(p.author.is_none());
        assert_eq!(p.url, "");
    }

    #[test]
    fn diffstat_maps_to_pr_file_out_including_renames() {
        let page: BbPage<BbDiffstat> = serde_json::from_str(
            r#"{"values":[
                {"status":"modified","lines_added":3,"lines_removed":1,
                 "old":{"path":"src/a.rs"},"new":{"path":"src/a.rs"}},
                {"status":"removed","lines_added":0,"lines_removed":9,
                 "old":{"path":"src/gone.rs"},"new":null},
                {"status":"added","lines_added":5,"lines_removed":0,
                 "old":null,"new":{"path":"src/new.rs"}},
                {"status":"renamed","lines_added":0,"lines_removed":0,
                 "old":{"path":"src/old.rs"},"new":{"path":"src/renamed.rs"}}
            ]}"#,
        )
        .unwrap();
        let files: Vec<PrFileOut> = page
            .values
            .into_iter()
            .map(|d| {
                let path = d
                    .new
                    .map(|p| p.path)
                    .filter(|p| !p.is_empty())
                    .or_else(|| d.old.map(|p| p.path))
                    .unwrap_or_default();
                PrFileOut {
                    path,
                    additions: d.lines_added,
                    deletions: d.lines_removed,
                }
            })
            .collect();
        assert_eq!(files[0].path, "src/a.rs");
        // Removed file: new is null → falls back to old path.
        assert_eq!(files[1].path, "src/gone.rs");
        assert_eq!(files[1].deletions, 9);
        // Added file: old is null → new path.
        assert_eq!(files[2].path, "src/new.rs");
        // Renamed: prefers the new path.
        assert_eq!(files[3].path, "src/renamed.rs");
    }

    #[test]
    fn comments_filter_deleted_and_pending_and_prefix_inline() {
        let page: BbPage<BbComment> = serde_json::from_str(
            r#"{"values":[
                {"id":1,"content":{"raw":"general note"},"user":{"display_name":"Bob"},
                 "created_on":"2026-01-01"},
                {"id":2,"content":{"raw":"needs fix"},"user":{"display_name":"Sue"},
                 "created_on":"2026-01-02","inline":{"path":"src/x.rs","to":12}},
                {"id":3,"content":{"raw":"gone"},"deleted":true,"created_on":"2026-01-03"},
                {"id":4,"content":{"raw":"draft"},"pending":true,"created_on":"2026-01-04"}
            ]}"#,
        )
        .unwrap();
        let threads: Vec<PrThreadOut> = page
            .values
            .into_iter()
            .filter(|c| !c.deleted && !c.pending)
            .map(from_bb_comment)
            .collect();
        assert_eq!(threads.len(), 2);
        // General comment untouched.
        assert_eq!(threads[0].body, "general note");
        assert_eq!(threads[0].author, "Bob");
        // Inline comment prefixed with file + line.
        assert!(threads[1].body.starts_with("**`src/x.rs`** (line 12):"));
        assert!(threads[1].body.contains("needs fix"));
    }

    #[test]
    fn pipeline_status_matrix_including_error_and_missing_result() {
        assert_eq!(
            map_bb_pipeline_status("COMPLETED", "SUCCESSFUL"),
            ("completed".into(), "success".into())
        );
        assert_eq!(
            map_bb_pipeline_status("COMPLETED", "FAILED"),
            ("completed".into(), "failure".into())
        );
        assert_eq!(
            map_bb_pipeline_status("COMPLETED", "ERROR"),
            ("completed".into(), "failure".into())
        );
        assert_eq!(
            map_bb_pipeline_status("COMPLETED", "STOPPED"),
            ("completed".into(), "cancelled".into())
        );
        // COMPLETED with no result → finished-neutral.
        assert_eq!(
            map_bb_pipeline_status("COMPLETED", ""),
            ("completed".into(), "".into())
        );
        assert_eq!(
            map_bb_pipeline_status("IN_PROGRESS", ""),
            ("in_progress".into(), "".into())
        );
        assert_eq!(
            map_bb_pipeline_status("PENDING", ""),
            ("queued".into(), "".into())
        );
    }

    #[test]
    fn pipeline_maps_to_workflow_run_with_nonempty_started_at() {
        let p: BbPipeline = serde_json::from_str(
            r#"{
                "uuid": "{abc-123}",
                "build_number": 17,
                "state": {"name": "COMPLETED", "result": {"name": "FAILED"}},
                "target": {"ref_name": "main", "commit": {"hash": "deadbeef"}},
                "trigger": {"name": "PUSH"},
                "created_on": "2026-02-01T00:00:00Z",
                "completed_on": "2026-02-01T00:05:00Z"
            }"#,
        )
        .unwrap();
        let run = from_bb_pipeline(p, "ws", "repo");
        assert_eq!(run.id, 17);
        assert_eq!(run.number, 17);
        assert_eq!(run.status, "completed");
        assert_eq!(run.conclusion, "failure");
        assert_eq!(run.workflow_name, "Push");
        assert_eq!(run.head_branch, "main");
        assert_eq!(run.event, "push");
        assert_eq!(run.head_sha, "deadbeef");
        // started_at must never be empty (Insights filters on it).
        assert!(!run.started_at.is_empty());
        assert_eq!(run.started_at, "2026-02-01T00:00:00Z");
        assert_eq!(run.updated_at, "2026-02-01T00:05:00Z");
        assert_eq!(
            run.url,
            "https://bitbucket.org/ws/repo/pipelines/results/17"
        );
    }

    #[test]
    fn pipeline_missing_completed_on_falls_back_to_created_on_for_updated_at() {
        let p: BbPipeline = serde_json::from_str(
            r#"{
                "uuid": "{x}",
                "build_number": 3,
                "state": {"name": "IN_PROGRESS"},
                "target": {"ref_name": "dev", "commit": {"hash": "aa"}},
                "trigger": {"name": "MANUAL"},
                "created_on": "2026-03-01T00:00:00Z"
            }"#,
        )
        .unwrap();
        let run = from_bb_pipeline(p, "ws", "repo");
        assert_eq!(run.updated_at, "2026-03-01T00:00:00Z");
        assert_eq!(run.started_at, "2026-03-01T00:00:00Z");
        assert_eq!(run.workflow_name, "Manual");
    }

    #[test]
    fn step_maps_to_run_job_with_synthetic_id_and_log_ref() {
        let s: BbStep = serde_json::from_str(
            r#"{
                "uuid": "{step-9}",
                "name": "Build",
                "state": {"name": "COMPLETED", "result": {"name": "SUCCESSFUL"}},
                "started_on": "2026-01-01T00:00:00Z",
                "completed_on": "2026-01-01T00:01:00Z"
            }"#,
        )
        .unwrap();
        let job = from_bb_step(
            0,
            s,
            "{pipe-1}",
            "https://bitbucket.org/ws/repo/pipelines/results/1",
        );
        // Synthetic 1-based id.
        assert_eq!(job.id, 1);
        assert_eq!(job.name, "Build");
        assert_eq!(job.status, "completed");
        assert_eq!(job.conclusion, "success");
        // log_ref carries the RAW braced UUIDs joined by '/'.
        assert_eq!(job.log_ref.as_deref(), Some("{pipe-1}/{step-9}"));
    }

    #[test]
    fn step_without_name_gets_synthetic_step_label() {
        let s: BbStep =
            serde_json::from_str(r#"{"uuid":"{s}","state":{"name":"PENDING"}}"#).unwrap();
        let job = from_bb_step(2, s, "{p}", "url");
        assert_eq!(job.name, "Step 3");
        assert_eq!(job.status, "queued");
    }

    #[test]
    fn repo_maps_clone_ssh_fork_and_private() {
        let r: BbRepo = serde_json::from_str(
            r#"{
                "name": "myrepo",
                "full_name": "ws/myrepo",
                "is_private": true,
                "description": "A repo",
                "updated_on": "2026-01-01",
                "parent": {"full_name": "other/myrepo"},
                "links": {
                    "clone": [
                        {"name": "https", "href": "https://bitbucket.org/ws/myrepo.git"},
                        {"name": "ssh", "href": "git@bitbucket.org:ws/myrepo.git"}
                    ]
                },
                "workspace": {"slug": "ws"}
            }"#,
        )
        .unwrap();
        let repo = from_bb_repo(r);
        assert_eq!(repo.full_name, "ws/myrepo");
        assert_eq!(repo.owner, "ws");
        assert_eq!(repo.name, "myrepo");
        assert!(repo.private);
        assert!(!repo.archived);
        assert!(repo.fork);
        assert_eq!(repo.clone_url, "https://bitbucket.org/ws/myrepo.git");
        assert_eq!(repo.ssh_url, "git@bitbucket.org:ws/myrepo.git");
    }

    #[test]
    fn repo_without_ssh_link_gets_empty_ssh_url_and_no_fork() {
        let r: BbRepo = serde_json::from_str(
            r#"{
                "name": "solo",
                "full_name": "ws/solo",
                "is_private": false,
                "links": {"clone": [{"name": "https", "href": "https://bitbucket.org/ws/solo.git"}]},
                "workspace": {"slug": "ws"}
            }"#,
        )
        .unwrap();
        let repo = from_bb_repo(r);
        assert!(!repo.private);
        assert!(!repo.fork);
        assert_eq!(repo.ssh_url, "");
    }

    #[test]
    fn user_workspaces_membership_wrappers_yield_slugs_and_skip_empty() {
        // The live CHANGE-3022 shape: `workspace_access` wrappers with a nested
        // `workspace_base` (uuid/slug/links, NO name). An entry with no nested
        // workspace or an empty slug is skipped.
        let page: BbPage<BbWorkspaceAccess> = serde_json::from_str(
            r#"{"values":[
                {"type":"workspace_access","administrator":true,
                 "workspace":{"type":"workspace_base","uuid":"{286b6e4c}","slug":"betabotsllc",
                              "links":{"avatar":{"href":"x"},"self":{"href":"y"}}}},
                {"type":"workspace_access","workspace":{"slug":""}},
                {"type":"workspace_access"}
            ]}"#,
        )
        .unwrap();
        let slugs: Vec<String> = page
            .values
            .into_iter()
            .filter_map(|a| a.workspace.map(|w| w.slug).filter(|s| !s.is_empty()))
            .collect();
        assert_eq!(slugs, vec!["betabotsllc".to_string()]);
    }

    #[test]
    fn uuid_percent_encoding_encodes_braces() {
        assert_eq!(encode_uuid("{abc-123}"), "%7Babc-123%7D");
        // Unreserved chars pass through.
        assert_eq!(encode_uuid("a.b-c_d~e"), "a.b-c_d~e");
    }

    #[test]
    fn check_state_maps_onto_frontend_vocabulary() {
        assert_eq!(map_bb_check_state("SUCCESSFUL"), "SUCCESS");
        assert_eq!(map_bb_check_state("FAILED"), "FAILURE");
        assert_eq!(map_bb_check_state("STOPPED"), "CANCELLED");
        assert_eq!(map_bb_check_state("INPROGRESS"), "PENDING");
    }

    #[test]
    fn bitbucket_status_assembly_no_token_unauth_and_ready() {
        // No token: not installed, not authenticated, no login, repo still filled.
        let s = bitbucket_status(false, false, "bitbucket.org", Some("ws/r".into()), None);
        assert!(!s.installed && !s.authenticated);
        assert_eq!(s.repo.as_deref(), Some("ws/r"));
        assert!(s.login.is_none());
        assert!(s.implemented.pull_requests && s.implemented.ci && s.implemented.repo_actions);

        // Token but unauthenticated (expired): installed, not authenticated.
        let s = bitbucket_status(
            true,
            false,
            "bitbucket.org",
            Some("ws/r".into()),
            Some("me".into()),
        );
        assert!(s.installed && !s.authenticated);
        assert_eq!(s.login.as_deref(), Some("me"));

        // Ready: installed + authenticated.
        let s = bitbucket_status(
            true,
            true,
            "bitbucket.org",
            Some("ws/r".into()),
            Some("me".into()),
        );
        assert!(s.installed && s.authenticated);
        assert_eq!(s.host.as_deref(), Some("bitbucket.org"));
        assert_eq!(s.provider, Some(Provider::Bitbucket));
    }

    #[test]
    fn pr_state_filter_rejects_unknown_values() {
        assert_eq!(pr_state_filter("open").unwrap(), "state=OPEN");
        assert_eq!(
            pr_state_filter("closed").unwrap(),
            "state=MERGED&state=DECLINED&state=SUPERSEDED"
        );
        assert!(matches!(
            pr_state_filter("all"),
            Err(AppError::InvalidArgument(_))
        ));
    }

    #[tokio::test]
    async fn prs_for_branch_rejects_quote_backslash_empty_and_dash_heads() {
        // Each of these is rejected BEFORE any network/credential I/O, so a bogus
        // repo path never matters — the validation error fires first.
        for bad in ["", "-x", "has\"quote", "has\\backslash"] {
            match prs_for_branch("C:/nonexistent", bad).await {
                Err(AppError::InvalidArgument(_)) => {}
                Err(e) => panic!("expected InvalidArgument for head {bad:?}, got {e:?}"),
                Ok(_) => panic!("expected InvalidArgument for head {bad:?}, got Ok"),
            }
        }
    }

    #[test]
    fn user_login_prefers_display_name_then_nickname() {
        let full: BbUser = serde_json::from_str(
            r#"{"username":"u","display_name":"Full Name","nickname":"nick"}"#,
        )
        .unwrap();
        assert_eq!(user_login(&full), "Full Name");
        let no_display: BbUser = serde_json::from_str(r#"{"nickname":"nick"}"#).unwrap();
        assert_eq!(user_login(&no_display), "nick");
    }

    // ── Write-side unit tests (pure; no network) ────────────────────────────────

    #[test]
    fn merge_strategy_maps_neutral_to_bitbucket_enum() {
        assert_eq!(map_merge_strategy("merge").unwrap(), "merge_commit");
        assert_eq!(map_merge_strategy("squash").unwrap(), "squash");
        assert_eq!(map_merge_strategy("fast_forward").unwrap(), "fast_forward");
        assert!(matches!(
            map_merge_strategy("rebase"),
            Err(AppError::InvalidArgument(_))
        ));
    }

    fn participants(json: &str) -> Vec<BbParticipant> {
        let page: BbPrParticipants = serde_json::from_str(json).unwrap();
        page.participants
    }

    #[test]
    fn approval_state_reflects_viewer_approval() {
        let ps = participants(
            r#"{"participants":[
                {"user":{"uuid":"{me}","nickname":"me"},"approved":true,"state":"approved"},
                {"user":{"uuid":"{other}","nickname":"other"},"approved":false,"state":null}
            ]}"#,
        );
        // Viewer matched by uuid; the viewer's approved_by entry is the passed login.
        let state = build_approval_state(&ps, "{me}", "me-login");
        assert!(state.viewer_has_approved);
        assert!(!state.viewer_requested_changes);
        assert_eq!(state.approved_by, vec!["me-login".to_string()]);
        assert_eq!(state.approvals_required, 0);
        assert_eq!(state.approvals_left, 0);
    }

    #[test]
    fn approval_state_matches_viewer_by_uuid_not_name() {
        // The reconciliation bug fixture: the viewer's nickname, username, and
        // display_name are ALL different, and the participant object carries no
        // username at all (Bitbucket's privacy behavior). Only uuid matching works.
        let ps = participants(
            r#"{"participants":[
                {"user":{"uuid":"{viewer-uuid}","nickname":"nick","display_name":"Display Name"},
                 "approved":true,"state":"approved"},
                {"user":{"uuid":"{other-uuid}","nickname":"other"},"approved":true,"state":"approved"}
            ]}"#,
        );
        // viewer_uuid matches the first participant; viewer_login is the account
        // username (what status().login emits), distinct from nickname/display_name.
        let state = build_approval_state(&ps, "{viewer-uuid}", "myusername");
        assert!(state.viewer_has_approved);
        // The viewer's own entry uses the login string (reconciles with the optimistic
        // toggle); the OTHER approver keeps their human-readable nickname.
        assert_eq!(
            state.approved_by,
            vec!["myusername".to_string(), "other".to_string()]
        );
    }

    #[test]
    fn approval_state_reflects_another_reviewer_requested_changes() {
        let ps = participants(
            r#"{"participants":[
                {"user":{"uuid":"{me}","nickname":"me"},"approved":false,"state":null},
                {"user":{"uuid":"{rev}","nickname":"rev"},"approved":false,"state":"changes_requested"}
            ]}"#,
        );
        let state = build_approval_state(&ps, "{me}", "me-login");
        // The viewer neither approved nor requested changes.
        assert!(!state.viewer_has_approved);
        assert!(!state.viewer_requested_changes);
        assert!(state.approved_by.is_empty());
    }

    #[test]
    fn approval_state_reflects_viewer_requested_changes() {
        let ps = participants(
            r#"{"participants":[
                {"user":{"uuid":"{me}","nickname":"me"},"approved":false,"state":"changes_requested"}
            ]}"#,
        );
        let state = build_approval_state(&ps, "{me}", "me-login");
        assert!(!state.viewer_has_approved);
        assert!(state.viewer_requested_changes);
    }

    #[test]
    fn approval_state_empty_viewer_uuid_never_matches() {
        // Defensive: if the self /user probe failed (empty uuid), no participant is
        // mistaken for the viewer (an empty uuid must not match a missing uuid).
        let ps = participants(
            r#"{"participants":[
                {"user":{"nickname":"someone"},"approved":true,"state":"approved"}
            ]}"#,
        );
        let state = build_approval_state(&ps, "", "me-login");
        assert!(!state.viewer_has_approved);
        assert!(!state.viewer_requested_changes);
        // The approver is not the viewer, so their nickname (not the login) is used.
        assert_eq!(state.approved_by, vec!["someone".to_string()]);
    }

    #[test]
    fn create_pr_maps_id_and_html_url_to_pr_ref() {
        let created: BbCreatedPr = serde_json::from_str(
            r#"{
                "id": 123,
                "title": "New feature",
                "links": {"html": {"href": "https://bitbucket.org/ws/repo/pull-requests/123"}}
            }"#,
        )
        .unwrap();
        let pr_ref = PrRef {
            number: created.id,
            url: html_href(&created.links),
        };
        assert_eq!(pr_ref.number, 123);
        assert_eq!(
            pr_ref.url,
            "https://bitbucket.org/ws/repo/pull-requests/123"
        );
    }

    #[test]
    fn duplicate_pr_number_matches_only_same_destination() {
        // `prs_for_branch` already constrains source==head + OPEN, so the fixtures here
        // are all open PRs from the same head; only the destination differs.
        let to_main = pr(r#"{"id":7,"title":"x","state":"OPEN",
            "source":{"branch":{"name":"feature/x"}},
            "destination":{"branch":{"name":"main"}}}"#);
        let to_develop = pr(r#"{"id":9,"title":"y","state":"OPEN",
            "source":{"branch":{"name":"feature/x"}},
            "destination":{"branch":{"name":"develop"}}}"#);
        // A PR into develop is not a duplicate of a create into main.
        assert_eq!(duplicate_pr_number(&[to_develop], "main"), None);
        // …but one already into main is.
        let list = vec![
            pr(r#"{"id":9,"title":"y","state":"OPEN",
                "source":{"branch":{"name":"feature/x"}},
                "destination":{"branch":{"name":"develop"}}}"#),
            to_main,
        ];
        assert_eq!(duplicate_pr_number(&list, "main"), Some(7));
        // Empty list → no duplicate.
        assert_eq!(duplicate_pr_number(&[], "main"), None);
    }

    #[test]
    fn create_body_carries_source_destination_and_draft() {
        let body = build_create_body("main", "feature/x", "Title", "Body", true);
        assert_eq!(body["title"], "Title");
        assert_eq!(body["description"], "Body");
        assert_eq!(body["source"]["branch"]["name"], "feature/x");
        assert_eq!(body["destination"]["branch"]["name"], "main");
        assert_eq!(body["draft"], true);
    }

    #[test]
    fn edit_body_echoes_reviewers_alongside_title_and_description() {
        let body = build_edit_body("T", "D", &["{uuid-1}".to_string(), "{uuid-2}".to_string()]);
        assert_eq!(body["title"], "T");
        assert_eq!(body["description"], "D");
        let reviewers = body["reviewers"].as_array().unwrap();
        assert_eq!(reviewers.len(), 2);
        assert_eq!(reviewers[0]["uuid"], "{uuid-1}");
        assert_eq!(reviewers[1]["uuid"], "{uuid-2}");
    }

    #[test]
    fn edit_body_with_no_reviewers_sends_empty_array_not_omitted() {
        let body = build_edit_body("T", "D", &[]);
        // The reviewers key is present (an empty array), so we never accidentally omit
        // it — which would WIPE reviewers on a PR that had them.
        assert!(body["reviewers"].is_array());
        assert_eq!(body["reviewers"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn trigger_body_with_variables_adds_sorted_variables_array() {
        let mut inputs = std::collections::HashMap::new();
        inputs.insert("DEPLOY_ENV".to_string(), "staging".to_string());
        inputs.insert("VERSION".to_string(), "1.2.3".to_string());
        let body = build_trigger_body("main", &inputs);
        assert_eq!(body["target"]["type"], "pipeline_ref_target");
        assert_eq!(body["target"]["ref_type"], "branch");
        assert_eq!(body["target"]["ref_name"], "main");
        let vars = body["variables"].as_array().unwrap();
        assert_eq!(vars.len(), 2);
        // Sorted by key for determinism.
        assert_eq!(vars[0]["key"], "DEPLOY_ENV");
        assert_eq!(vars[0]["value"], "staging");
        assert_eq!(vars[1]["key"], "VERSION");
        assert_eq!(vars[1]["value"], "1.2.3");
    }

    #[test]
    fn trigger_body_without_variables_omits_the_array() {
        let body = build_trigger_body("dev", &std::collections::HashMap::new());
        assert_eq!(body["target"]["ref_name"], "dev");
        // No `variables` key at all when inputs are empty.
        assert!(body.get("variables").is_none());
    }
}
