use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::git::runner::{run_git_mutating, NETWORK_TIMEOUT};
use crate::github::runner::{run_gh, run_gh_raw, GH_NETWORK_TIMEOUT, GH_TIMEOUT};
use crate::state::AppState;

fn validate_branch(name: &str) -> AppResult<()> {
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid branch: {name}")));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    pub installed: bool,
    pub authenticated: bool,
    /// "owner/name" when this repo has a GitHub remote gh recognizes.
    pub repo: Option<String>,
    /// The active account's login, when it can be determined.
    pub login: Option<String>,
}

/// Probes the GitHub CLI: present on PATH, logged in, and pointing at a
/// GitHub repo. Drives whether the PR features are offered at all.
#[tauri::command]
pub async fn gh_status(repo_path: String) -> AppResult<GhStatus> {
    match run_gh_raw(None, &["--version"], GH_TIMEOUT).await {
        Err(AppError::GhNotFound) => {
            return Ok(GhStatus {
                installed: false,
                authenticated: false,
                repo: None,
                login: None,
            });
        }
        Err(e) => return Err(e),
        Ok(_) => {}
    }

    // `gh auth status` exits 0 only when a host is logged in. Its report
    // (stderr on old gh, stdout on newer) names the account(s).
    let (authenticated, login) = match run_gh_raw(None, &["auth", "status"], GH_TIMEOUT).await {
        Ok(out) => {
            let report = format!("{}\n{}", out.stdout_lossy(), out.stderr);
            let active = parse_auth_accounts(&report)
                .into_iter()
                .find(|(_, active)| *active)
                .map(|(login, _)| login);
            (out.code == 0, active)
        }
        Err(_) => (false, None),
    };

    let repo = if authenticated {
        run_gh_raw(
            Some(&repo_path),
            &["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
            GH_TIMEOUT,
        )
        .await
        .ok()
        .filter(|o| o.code == 0)
        .map(|o| o.stdout_lossy().trim().to_string())
        .filter(|s| !s.is_empty())
    } else {
        None
    };

    Ok(GhStatus {
        installed: true,
        authenticated,
        repo,
        login,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhRepo {
    pub name_with_owner: String,
    pub owner: String,
    pub name: String,
    pub private: bool,
    pub archived: bool,
    pub fork: bool,
    pub clone_url: String,
    pub ssh_url: String,
    pub description: Option<String>,
    /// ISO-8601 last-push time, for recency sorting.
    pub pushed_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhRepoList {
    /// The signed-in user's login, so the UI can list their own repos first.
    pub viewer: String,
    pub repos: Vec<GhRepo>,
}

/// Every repository the signed-in user can access (owned, collaborator, and
/// org member), newest-push first, plus the viewer's login. Used by the
/// clone dialog's GitHub.com tab. `--paginate` merges all pages into one
/// JSON array.
#[tauri::command]
pub async fn gh_list_repos() -> AppResult<GhRepoList> {
    // The viewer's login is cheap and lets the UI group their repos first.
    let viewer = run_gh(None, &["api", "user", "-q", ".login"], GH_TIMEOUT)
        .await?
        .stdout_lossy()
        .trim()
        .to_string();

    let out = run_gh(
        None,
        &[
            "api",
            "--paginate",
            "-X",
            "GET",
            "user/repos",
            "-f",
            "per_page=100",
            "-f",
            "affiliation=owner,collaborator,organization_member",
            "-f",
            "sort=pushed",
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;

    #[derive(Deserialize)]
    struct ApiOwner {
        login: String,
    }
    #[derive(Deserialize)]
    struct ApiRepo {
        full_name: String,
        name: String,
        owner: ApiOwner,
        private: bool,
        archived: bool,
        fork: bool,
        clone_url: String,
        ssh_url: String,
        description: Option<String>,
        pushed_at: Option<String>,
    }
    let parsed: Vec<ApiRepo> = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse your repositories: {e}")))?;
    let repos = parsed
        .into_iter()
        .map(|r| GhRepo {
            name_with_owner: r.full_name,
            owner: r.owner.login,
            name: r.name,
            private: r.private,
            archived: r.archived,
            fork: r.fork,
            clone_url: r.clone_url,
            ssh_url: r.ssh_url,
            description: r.description,
            pushed_at: r.pushed_at,
        })
        .collect();
    Ok(GhRepoList { viewer, repos })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhAccount {
    pub login: String,
    pub active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhAccounts {
    /// gh's version (e.g. "2.18.1"), "" when gh isn't installed.
    pub version: String,
    pub accounts: Vec<GhAccount>,
}

/// The gh CLI's signed-in accounts and version (account switching needs
/// gh ≥ 2.40).
#[tauri::command]
pub async fn gh_accounts() -> AppResult<GhAccounts> {
    let version = match run_gh_raw(None, &["--version"], GH_TIMEOUT).await {
        Err(AppError::GhNotFound) => {
            return Ok(GhAccounts {
                version: String::new(),
                accounts: Vec::new(),
            });
        }
        Err(e) => return Err(e),
        // "gh version 2.18.1 (2022-10-20)" → "2.18.1"
        Ok(out) => out
            .stdout_lossy()
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(2))
            .unwrap_or("")
            .to_string(),
    };
    let accounts = match run_gh_raw(None, &["auth", "status"], GH_TIMEOUT).await {
        Ok(out) => {
            let report = format!("{}\n{}", out.stdout_lossy(), out.stderr);
            parse_auth_accounts(&report)
                .into_iter()
                .map(|(login, active)| GhAccount { login, active })
                .collect()
        }
        Err(_) => Vec::new(),
    };
    Ok(GhAccounts { version, accounts })
}

/// Switches the active gh account (gh ≥ 2.40; older gh errors, which the
/// UI surfaces with an upgrade hint).
#[tauri::command]
pub async fn gh_switch_account(login: String) -> AppResult<()> {
    if login.is_empty()
        || !login
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::InvalidArgument(format!("invalid login: {login}")));
    }
    run_gh(
        None,
        &[
            "auth",
            "switch",
            "--hostname",
            "github.com",
            "--user",
            &login,
        ],
        GH_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Accounts from a `gh auth status` report, with the active one flagged.
/// Handles both formats: old gh prints "Logged in to <host> as <login>",
/// gh 2.40+ prints "Logged in to <host> account <login>" with a separate
/// "Active account: true" line per account.
fn parse_auth_accounts(report: &str) -> Vec<(String, bool)> {
    let mut accounts: Vec<(String, bool)> = Vec::new();
    for line in report.lines() {
        if let Some(rest) = line
            .split_once(" as ")
            .or_else(|| line.split_once(" account "))
            .filter(|_| line.contains("Logged in to"))
            .map(|(_, rest)| rest)
        {
            let login = rest
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-')
                .to_string();
            if !login.is_empty() {
                accounts.push((login, false));
            }
        } else if line.contains("Active account: true") {
            if let Some(last) = accounts.last_mut() {
                last.1 = true;
            }
        }
    }
    // Old gh has no active marker — the only account is the active one.
    if !accounts.is_empty() && !accounts.iter().any(|(_, a)| *a) {
        accounts[0].1 = true;
    }
    accounts
}

/// Creates a GitHub repository from the local one, wires up `origin`, and
/// pushes the current branch — GitHub Desktop's "Publish repository". `name`
/// may be `repo` (under your account) or `owner/repo` (under an org).
#[tauri::command]
pub async fn gh_publish_repo(
    repo_path: String,
    name: String,
    private: bool,
    description: String,
) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::InvalidArgument(
            "a repository name is required".into(),
        ));
    }
    let visibility = if private { "--private" } else { "--public" };
    let mut args: Vec<&str> = vec![
        "repo", "create", name, "--source", ".", "--remote", "origin", "--push", visibility,
    ];
    let description = description.trim();
    if !description.is_empty() {
        args.push("--description");
        args.push(description);
    }
    run_gh(Some(&repo_path), &args, GH_NETWORK_TIMEOUT).await?;

    // gh's create output is human-prose on stderr; read back the canonical URL.
    gh_repo_url(repo_path).await
}

/// The repository's web URL (works for github.com and GitHub Enterprise).
/// Append paths like `/issues/new` for specific pages.
#[tauri::command]
pub async fn gh_repo_url(repo_path: String) -> AppResult<String> {
    let out = run_gh(
        Some(&repo_path),
        &["repo", "view", "--json", "url", "-q", ".url"],
        GH_TIMEOUT,
    )
    .await?;
    let url = out.stdout_lossy().trim().to_string();
    if url.is_empty() {
        return Err(AppError::Gh(
            "could not determine the repository URL".into(),
        ));
    }
    Ok(url)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrRef {
    pub number: u64,
    pub url: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrAuthor {
    pub login: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrListLabel {
    pub name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: u64,
    pub url: String,
    pub title: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
    pub is_draft: bool,
    pub state: String,
    // Defaults tolerate callers that don't request these fields.
    #[serde(default)]
    pub author: Option<PrAuthor>,
    #[serde(default)]
    pub labels: Vec<PrListLabel>,
}

/// Submits a review: `action` is "approve", "comment", or "request_changes".
/// gh requires a body for comment/request-changes (it surfaces the error).
#[tauri::command]
pub async fn gh_pr_review(
    repo_path: String,
    number: u64,
    action: String,
    body: String,
) -> AppResult<()> {
    let n = number.to_string();
    let flag = match action.as_str() {
        "approve" => "--approve",
        "comment" => "--comment",
        "request_changes" => "--request-changes",
        _ => {
            return Err(AppError::InvalidArgument(format!(
                "unknown review action: {action}"
            )));
        }
    };
    let body = body.trim();
    let mut args = vec!["pr", "review", &n, flag];
    if !body.is_empty() {
        args.push("--body");
        args.push(body);
    }
    run_gh(Some(&repo_path), &args, GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

/// Adds a standalone comment to the PR conversation.
#[tauri::command]
pub async fn gh_pr_comment(repo_path: String, number: u64, body: String) -> AppResult<()> {
    if body.trim().is_empty() {
        return Err(AppError::InvalidArgument("a comment is required".into()));
    }
    let n = number.to_string();
    run_gh(
        Some(&repo_path),
        &["pr", "comment", &n, "--body", &body],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Merges the PR with the given strategy ("merge"/"squash"/"rebase"),
/// optionally deleting the head branch afterwards.
#[tauri::command]
pub async fn gh_pr_merge(
    repo_path: String,
    number: u64,
    strategy: String,
    delete_branch: bool,
) -> AppResult<()> {
    let n = number.to_string();
    let method = match strategy.as_str() {
        "merge" => "--merge",
        "squash" => "--squash",
        "rebase" => "--rebase",
        _ => {
            return Err(AppError::InvalidArgument(format!(
                "unknown merge strategy: {strategy}"
            )));
        }
    };
    let mut args = vec!["pr", "merge", &n, method];
    if delete_branch {
        args.push("--delete-branch");
    }
    run_gh(Some(&repo_path), &args, GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn gh_pr_close(repo_path: String, number: u64) -> AppResult<()> {
    let n = number.to_string();
    run_gh(Some(&repo_path), &["pr", "close", &n], GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

/// Reopens a closed (not merged) pull request.
#[tauri::command]
pub async fn gh_pr_reopen(repo_path: String, number: u64) -> AppResult<()> {
    let n = number.to_string();
    run_gh(Some(&repo_path), &["pr", "reopen", &n], GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

/// Edits the body of an existing PR conversation comment, addressed by its
/// GraphQL node id (from `gh pr view`). GitHub only lets the comment's author
/// edit it, so this is offered solely on the viewer's own comments.
#[tauri::command]
pub async fn gh_pr_edit_comment(
    repo_path: String,
    comment_id: String,
    body: String,
) -> AppResult<()> {
    if body.trim().is_empty() {
        return Err(AppError::InvalidArgument("a comment is required".into()));
    }
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "graphql",
            "-f",
            "query=mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id}}}",
            "-f",
            &format!("id={comment_id}"),
            "-f",
            &format!("body={body}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Permanently deletes a PR conversation comment by its GraphQL node id.
#[tauri::command]
pub async fn gh_pr_delete_comment(repo_path: String, comment_id: String) -> AppResult<()> {
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "graphql",
            "-f",
            "query=mutation($id:ID!){deleteIssueComment(input:{id:$id}){clientMutationId}}",
            "-f",
            &format!("id={comment_id}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Hides (minimizes) a comment with a reason. `classifier` is a GitHub
/// `ReportedContentClassifiers` value: SPAM, ABUSE, OFF_TOPIC, OUTDATED,
/// DUPLICATE, or RESOLVED.
#[tauri::command]
pub async fn gh_pr_minimize_comment(
    repo_path: String,
    comment_id: String,
    classifier: String,
) -> AppResult<()> {
    const VALID: [&str; 6] = [
        "SPAM",
        "ABUSE",
        "OFF_TOPIC",
        "OUTDATED",
        "DUPLICATE",
        "RESOLVED",
    ];
    if !VALID.contains(&classifier.as_str()) {
        return Err(AppError::InvalidArgument(format!(
            "invalid classifier: {classifier}"
        )));
    }
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "graphql",
            "-f",
            "query=mutation($id:ID!,$c:ReportedContentClassifiers!){minimizeComment(input:{subjectId:$id,classifier:$c}){minimizedComment{isMinimized}}}",
            "-f",
            &format!("id={comment_id}"),
            "-f",
            &format!("c={classifier}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Unhides (unminimizes) a previously hidden comment.
#[tauri::command]
pub async fn gh_pr_unminimize_comment(repo_path: String, comment_id: String) -> AppResult<()> {
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "graphql",
            "-f",
            "query=mutation($id:ID!){unminimizeComment(input:{subjectId:$id}){unminimizedComment{isMinimized}}}",
            "-f",
            &format!("id={comment_id}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Checks out a PR's branch locally (handles fork-sourced PRs too).
#[tauri::command]
pub async fn gh_pr_checkout(repo_path: String, number: u64) -> AppResult<()> {
    let n = number.to_string();
    run_gh(
        Some(&repo_path),
        &["pr", "checkout", &n],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// "owner/repo" from a remote URL — handles https://host/owner/repo(.git)
/// and git@host:owner/repo(.git).
fn name_with_owner_from_url(url: &str) -> Option<String> {
    let cleaned = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let mut parts = cleaned.rsplitn(3, ['/', ':']);
    let repo = parts.next()?;
    let owner = parts.next()?;
    if repo.is_empty() || owner.is_empty() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

/// Forks the repo on GitHub. Remotes follow gh's default rewiring (the fork
/// becomes `origin`, the original `upstream`); `contribute_to_parent`
/// decides which of the two `gh repo set-default` points at — that's what
/// PR lists/creation, issues, and "View on GitHub" follow afterwards.
#[tauri::command]
pub async fn gh_repo_fork(repo_path: String, contribute_to_parent: bool) -> AppResult<String> {
    // Before forking, origin still points at the parent.
    let parent = run_gh(
        Some(&repo_path),
        &["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        GH_TIMEOUT,
    )
    .await?
    .stdout_lossy()
    .trim()
    .to_string();

    let out = run_gh(
        Some(&repo_path),
        &["repo", "fork", "--remote"],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    // gh prints progress to stderr; stdout carries the fork's URL when
    // creation succeeds (empty if the fork already existed).
    let fork_url = out.stdout_lossy().trim().to_string();

    let target = if contribute_to_parent {
        parent
    } else {
        // After --remote, origin points at the fork.
        let origin = crate::git::runner::run_git(
            Some(&repo_path),
            &["remote", "get-url", "origin"],
            crate::git::runner::DEFAULT_TIMEOUT,
        )
        .await?
        .stdout_lossy()
        .trim()
        .to_string();
        name_with_owner_from_url(&origin)
            .ok_or_else(|| AppError::Gh(format!("could not parse fork from {origin}")))?
    };
    run_gh(
        Some(&repo_path),
        &["repo", "set-default", &target],
        GH_TIMEOUT,
    )
    .await?;
    Ok(fork_url)
}

/// Marks a draft PR as ready for review.
#[tauri::command]
pub async fn gh_pr_ready(repo_path: String, number: u64) -> AppResult<()> {
    let n = number.to_string();
    run_gh(Some(&repo_path), &["pr", "ready", &n], GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

const PR_LIST_FIELDS: &str =
    "number,url,title,baseRefName,headRefName,isDraft,state,author,labels";

/// PRs for the Pull Requests list. `state` is "open" or "closed"; closed
/// uses the search qualifier so merged PRs are included, matching the
/// semantics of GitHub's own Closed tab.
#[tauri::command]
pub async fn gh_pr_list(repo_path: String, state: String) -> AppResult<Vec<PrInfo>> {
    let args: &[&str] = match state.as_str() {
        "open" => &["pr", "list", "--state", "open", "--json", PR_LIST_FIELDS],
        "closed" => &[
            "pr",
            "list",
            "--search",
            "is:closed",
            "--json",
            PR_LIST_FIELDS,
        ],
        _ => {
            return Err(AppError::InvalidArgument(format!(
                "unknown PR state filter: {state}"
            )));
        }
    };
    let out = run_gh(Some(&repo_path), args, GH_TIMEOUT).await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh pr list: {e}")))
}

// NOTE: `gh pr edit` is unusable on older gh versions (its GraphQL query
// still selects the sunset Projects-classic `projectCards` field, which the
// API now rejects outright), so PR edits go through `gh api` instead: REST
// for title/body, GraphQL mutations for labels.

/// Updates a PR's title and body via the REST API.
#[tauri::command]
pub async fn gh_pr_edit(
    repo_path: String,
    number: u64,
    title: String,
    body: String,
) -> AppResult<()> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidArgument("a PR title is required".into()));
    }
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PATCH",
            &format!("repos/{{owner}}/{{repo}}/pulls/{number}"),
            "-f",
            &format!("title={title}"),
            "-f",
            &format!("body={body}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoLabel {
    /// GraphQL node id; needed for the label mutations. May be empty on
    /// labels embedded in `gh pr view` output.
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Hex without the leading '#', as GitHub returns it.
    #[serde(default)]
    pub color: String,
}

/// GraphQL node ids and owner/repo names are embedded into query strings;
/// restrict them to their known-safe alphabets so quoting can't be escaped.
fn validate_graphql_embed(value: &str, what: &str) -> AppResult<()> {
    let ok = !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '=' | '+' | '/'));
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidArgument(format!("invalid {what}: {value}")))
    }
}

/// The repository's labels with their GraphQL node ids, for the PR label
/// picker. (`gh label list --json id` returns empty ids on older gh.)
#[tauri::command]
pub async fn gh_repo_labels(repo_path: String) -> AppResult<Vec<RepoLabel>> {
    let out = run_gh(
        Some(&repo_path),
        &["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        GH_TIMEOUT,
    )
    .await?;
    let name_with_owner = out.stdout_lossy().trim().to_string();
    let Some((owner, name)) = name_with_owner.split_once('/') else {
        return Err(AppError::Gh("could not determine the repository owner".into()));
    };
    validate_graphql_embed(owner, "repository owner")?;
    validate_graphql_embed(name, "repository name")?;

    let query = format!(
        r#"query{{ repository(owner:"{owner}", name:"{name}"){{ labels(first:100){{ nodes{{ id name color }} }} }} }}"#
    );
    let out = run_gh(
        Some(&repo_path),
        &["api", "graphql", "-f", &format!("query={query}")],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let value: serde_json::Value = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse the label query: {e}")))?;
    let nodes = value
        .pointer("/data/repository/labels/nodes")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(vec![]));
    serde_json::from_value(nodes)
        .map_err(|e| AppError::Gh(format!("could not parse the label query: {e}")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPollInfo {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub is_draft: bool,
    pub author: String,
    pub review_decision: String,
    /// Rollup of the head commit's checks: SUCCESS/FAILURE/PENDING/"".
    pub checks_state: String,
}

/// Lightweight snapshot of the repo's recently-updated PRs for the
/// notification poller — one GraphQL round trip including the check rollup
/// (reliable on old gh, unlike `pr list --json statusCheckRollup`).
#[tauri::command]
pub async fn gh_pr_poll(repo_path: String) -> AppResult<Vec<PrPollInfo>> {
    let out = run_gh(
        Some(&repo_path),
        &["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        GH_TIMEOUT,
    )
    .await?;
    let name_with_owner = out.stdout_lossy().trim().to_string();
    let Some((owner, name)) = name_with_owner.split_once('/') else {
        return Err(AppError::Gh("could not determine the repository owner".into()));
    };
    validate_graphql_embed(owner, "repository owner")?;
    validate_graphql_embed(name, "repository name")?;

    let query = format!(
        r#"query{{ repository(owner:"{owner}", name:"{name}"){{ pullRequests(first:30, states:[OPEN, CLOSED, MERGED], orderBy:{{field:UPDATED_AT, direction:DESC}}){{ nodes{{ number title url state isDraft author{{login}} reviewDecision commits(last:1){{ nodes{{ commit{{ statusCheckRollup{{ state }} }} }} }} }} }} }} }}"#
    );
    let out = run_gh(
        Some(&repo_path),
        &["api", "graphql", "-f", &format!("query={query}")],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let value: serde_json::Value = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse the PR poll: {e}")))?;
    let nodes = value
        .pointer("/data/repository/pullRequests/nodes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let str_at = |v: &serde_json::Value, p: &str| {
        v.pointer(p).and_then(|x| x.as_str()).unwrap_or("").to_string()
    };
    Ok(nodes
        .iter()
        .map(|n| PrPollInfo {
            number: n.pointer("/number").and_then(|x| x.as_u64()).unwrap_or(0),
            title: str_at(n, "/title"),
            url: str_at(n, "/url"),
            state: str_at(n, "/state"),
            is_draft: n
                .pointer("/isDraft")
                .and_then(|x| x.as_bool())
                .unwrap_or(false),
            author: str_at(n, "/author/login"),
            review_decision: str_at(n, "/reviewDecision"),
            checks_state: str_at(n, "/commits/nodes/0/commit/statusCheckRollup/state"),
        })
        .filter(|p| p.number > 0)
        .collect())
}

/// Adds/removes labels on a PR via GraphQL mutations. `labelable_id` is the
/// PR's GraphQL node id; the label ids come from `gh_repo_labels`.
#[tauri::command]
pub async fn gh_pr_edit_labels(
    repo_path: String,
    labelable_id: String,
    add_ids: Vec<String>,
    remove_ids: Vec<String>,
) -> AppResult<()> {
    if add_ids.is_empty() && remove_ids.is_empty() {
        return Ok(());
    }
    validate_graphql_embed(&labelable_id, "PR id")?;
    for id in add_ids.iter().chain(remove_ids.iter()) {
        validate_graphql_embed(id, "label id")?;
    }

    let quote_list = |ids: &[String]| {
        ids.iter()
            .map(|i| format!(r#""{i}""#))
            .collect::<Vec<_>>()
            .join(",")
    };
    let mut parts = Vec::new();
    if !add_ids.is_empty() {
        parts.push(format!(
            r#"a: addLabelsToLabelable(input:{{labelableId:"{labelable_id}", labelIds:[{}]}}){{ clientMutationId }}"#,
            quote_list(&add_ids)
        ));
    }
    if !remove_ids.is_empty() {
        parts.push(format!(
            r#"r: removeLabelsFromLabelable(input:{{labelableId:"{labelable_id}", labelIds:[{}]}}){{ clientMutationId }}"#,
            quote_list(&remove_ids)
        ));
    }
    let query = format!("mutation{{ {} }}", parts.join(" "));
    run_gh(
        Some(&repo_path),
        &["api", "graphql", "-f", &format!("query={query}")],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

// --- gh pr view: deserialize gh's JSON, then map to a clean frontend shape ---

#[derive(Deserialize)]
struct RawLogin {
    #[serde(default)]
    login: String,
}

#[derive(Deserialize)]
struct RawCommitAuthor {
    #[serde(default)]
    name: String,
    #[serde(default)]
    login: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCommit {
    #[serde(default)]
    oid: String,
    #[serde(default)]
    message_headline: String,
    #[serde(default)]
    authored_date: String,
    #[serde(default)]
    authors: Vec<RawCommitAuthor>,
}

#[derive(Deserialize)]
struct RawFile {
    #[serde(default)]
    path: String,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawReview {
    author: Option<RawLogin>,
    #[serde(default)]
    state: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    submitted_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawComment {
    #[serde(default)]
    id: String,
    author: Option<RawLogin>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    is_minimized: bool,
    #[serde(default)]
    minimized_reason: String,
    #[serde(default)]
    viewer_did_author: bool,
}

/// statusCheckRollup is a union of CheckRun (name/conclusion) and StatusContext
/// (context/state); accept any of the keys and normalize below.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCheck {
    #[serde(default)]
    name: String,
    #[serde(default)]
    context: String,
    #[serde(default)]
    conclusion: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPr {
    /// GraphQL node id, used by the label mutations.
    #[serde(default)]
    id: String,
    #[serde(default)]
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
    author: Option<RawLogin>,
    #[serde(default)]
    state: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
    #[serde(default)]
    url: String,
    #[serde(default)]
    commits: Vec<RawCommit>,
    #[serde(default)]
    files: Vec<RawFile>,
    #[serde(default)]
    reviews: Vec<RawReview>,
    #[serde(default)]
    comments: Vec<RawComment>,
    #[serde(default)]
    status_check_rollup: Vec<RawCheck>,
    #[serde(default)]
    labels: Vec<RepoLabel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCommitOut {
    pub oid: String,
    pub headline: String,
    pub date: String,
    pub author: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFileOut {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrThreadOut {
    pub author: String,
    pub state: String,
    pub body: String,
    pub date: String,
    /// GraphQL node id — set for conversation comments, empty for reviews
    /// (which use a different edit path and aren't editable here).
    pub id: String,
    /// Permalink to the comment on GitHub ("" for reviews) — for "Copy link".
    pub url: String,
    /// Whether the signed-in user wrote it — drives the edit affordance.
    pub viewer_did_author: bool,
    /// Whether the comment is hidden (minimized), and GitHub's reason for it.
    pub is_minimized: bool,
    pub minimized_reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCheckOut {
    pub name: String,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDetails {
    /// GraphQL node id, used by the label mutations.
    pub id: String,
    pub number: u64,
    pub title: String,
    pub body: String,
    pub author: String,
    pub state: String,
    pub is_draft: bool,
    pub base_ref_name: String,
    pub head_ref_name: String,
    pub additions: u32,
    pub deletions: u32,
    pub url: String,
    pub commits: Vec<PrCommitOut>,
    pub files: Vec<PrFileOut>,
    pub reviews: Vec<PrThreadOut>,
    pub comments: Vec<PrThreadOut>,
    pub checks: Vec<PrCheckOut>,
    pub labels: Vec<RepoLabel>,
}

const PR_VIEW_FIELDS: &str = "id,number,title,body,author,state,isDraft,baseRefName,headRefName,additions,deletions,url,commits,files,reviews,comments,statusCheckRollup,labels";

/// Full details for one PR's read view.
#[tauri::command]
pub async fn gh_pr_view(repo_path: String, number: u64) -> AppResult<PrDetails> {
    let out = run_gh(
        Some(&repo_path),
        &["pr", "view", &number.to_string(), "--json", PR_VIEW_FIELDS],
        GH_TIMEOUT,
    )
    .await?;
    let raw: RawPr = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh pr view: {e}")))?;

    let login = |a: Option<RawLogin>| a.map(|x| x.login).unwrap_or_default();
    Ok(PrDetails {
        id: raw.id,
        number: raw.number,
        title: raw.title,
        body: raw.body,
        author: login(raw.author),
        state: raw.state,
        is_draft: raw.is_draft,
        base_ref_name: raw.base_ref_name,
        head_ref_name: raw.head_ref_name,
        additions: raw.additions,
        deletions: raw.deletions,
        url: raw.url,
        commits: raw
            .commits
            .into_iter()
            .map(|c| {
                let author = c
                    .authors
                    .into_iter()
                    .next()
                    .map(|a| if a.name.is_empty() { a.login } else { a.name })
                    .unwrap_or_default();
                PrCommitOut {
                    oid: c.oid,
                    headline: c.message_headline,
                    date: c.authored_date,
                    author,
                }
            })
            .collect(),
        files: raw
            .files
            .into_iter()
            .map(|f| PrFileOut {
                path: f.path,
                additions: f.additions,
                deletions: f.deletions,
            })
            .collect(),
        reviews: raw
            .reviews
            .into_iter()
            .map(|r| PrThreadOut {
                author: login(r.author),
                state: r.state,
                body: r.body,
                date: r.submitted_at,
                id: String::new(),
                url: String::new(),
                viewer_did_author: false,
                is_minimized: false,
                minimized_reason: String::new(),
            })
            .collect(),
        comments: raw
            .comments
            .into_iter()
            .map(|c| PrThreadOut {
                author: login(c.author),
                state: String::new(),
                body: c.body,
                date: c.created_at,
                id: c.id,
                url: c.url,
                viewer_did_author: c.viewer_did_author,
                is_minimized: c.is_minimized,
                minimized_reason: c.minimized_reason,
            })
            .collect(),
        checks: raw
            .status_check_rollup
            .into_iter()
            .map(|c| {
                let name = if c.name.is_empty() { c.context } else { c.name };
                let status = [c.conclusion, c.state, c.status]
                    .into_iter()
                    .find(|s| !s.is_empty())
                    .unwrap_or_default();
                PrCheckOut { name, status }
            })
            .collect(),
        labels: raw.labels,
    })
}

/// The PR's full unified diff (`gh pr diff`), capped for the webview. The
/// frontend splits it per file for the diff viewer.
#[tauri::command]
pub async fn gh_pr_diff(repo_path: String, number: u64) -> AppResult<String> {
    let out = run_gh(
        Some(&repo_path),
        &["pr", "diff", &number.to_string()],
        GH_TIMEOUT,
    )
    .await?;
    let (text, _) =
        crate::git::diff::truncate_at_char_boundary(out.stdout_lossy(), 2_000_000);
    Ok(text)
}

/// Open PRs whose head is `head` (there's at most one per base). Lets the UI
/// offer "View pull request" instead of "Create" once one already exists.
#[tauri::command]
pub async fn gh_prs_for_branch(repo_path: String, head: String) -> AppResult<Vec<PrInfo>> {
    if head.is_empty() || head.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid branch: {head}")));
    }
    let out = run_gh(
        Some(&repo_path),
        &[
            "pr",
            "list",
            "--head",
            &head,
            "--state",
            "open",
            "--json",
            "number,url,title,baseRefName,headRefName,isDraft,state",
        ],
        GH_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh pr list: {e}")))
}

/// Pushes `head` to origin, then opens a PR from `head` into `base`. Returns
/// the new PR's number and URL.
#[tauri::command]
pub async fn gh_pr_create(
    state: State<'_, AppState>,
    repo_path: String,
    base: String,
    head: String,
    title: String,
    body: String,
    draft: bool,
) -> AppResult<PrRef> {
    validate_branch(&base)?;
    validate_branch(&head)?;
    if title.trim().is_empty() {
        return Err(AppError::InvalidArgument("a PR title is required".into()));
    }

    // gh can only open a PR for a branch that exists on the remote.
    run_git_mutating(
        &state,
        &repo_path,
        &["push", "-u", "origin", &head],
        NETWORK_TIMEOUT,
    )
    .await?;

    let mut args = vec![
        "pr", "create", "--base", &base, "--head", &head, "--title", &title, "--body", &body,
    ];
    if draft {
        args.push("--draft");
    }
    let out = run_gh(Some(&repo_path), &args, GH_NETWORK_TIMEOUT).await?;

    // gh prints the new PR's URL as its last stdout line.
    let url = out
        .stdout_lossy()
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| l.starts_with("http"))
        .unwrap_or_default()
        .to_string();
    let number = url
        .rsplit('/')
        .next()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    Ok(PrRef { number, url })
}
