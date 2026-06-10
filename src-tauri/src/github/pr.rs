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
            });
        }
        Err(e) => return Err(e),
        Ok(_) => {}
    }

    // `gh auth status` exits 0 only when a host is logged in.
    let authenticated = run_gh_raw(None, &["auth", "status"], GH_TIMEOUT)
        .await
        .map(|o| o.code == 0)
        .unwrap_or(false);

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
    })
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
pub struct PrInfo {
    pub number: u64,
    pub url: String,
    pub title: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
    pub is_draft: bool,
    pub state: String,
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
