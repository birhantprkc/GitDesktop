use tauri::State;

use crate::error::AppResult;
use crate::git::runner::{run_git, run_git_mutating, run_git_raw, DEFAULT_TIMEOUT};
use crate::git::types::{CommitAuthor, CommitResult, CommitSummary};
use crate::state::AppState;

/// The identity `git commit` would use in this repo (config user.name /
/// user.email, empty when unset) — lets the UI keep the author out of the
/// co-author suggestions.
#[tauri::command]
pub async fn git_user_identity(repo_path: String) -> AppResult<CommitAuthor> {
    async fn config_value(repo: &str, key: &str) -> String {
        run_git_raw(Some(repo), &["config", "--get", key], DEFAULT_TIMEOUT)
            .await
            .ok()
            .filter(|o| o.code == 0)
            .map(|o| o.stdout_lossy().trim().to_string())
            .unwrap_or_default()
    }
    Ok(CommitAuthor {
        name: config_value(&repo_path, "user.name").await,
        email: config_value(&repo_path, "user.email").await,
    })
}

/// Distinct commit authors across all refs, most recent first — co-author
/// suggestions for the commit box. Capped so huge repos stay fast.
#[tauri::command]
pub async fn git_commit_authors(repo_path: String) -> AppResult<Vec<CommitAuthor>> {
    let out = run_git_raw(
        Some(&repo_path),
        &["log", "--all", "-n", "500", "--format=%an%x00%ae"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    // A repo with no commits yet has no authors to suggest.
    if out.code != 0 {
        return Ok(Vec::new());
    }
    let text = out.stdout_lossy();
    let mut seen = std::collections::HashSet::new();
    let mut authors = Vec::new();
    for line in text.lines() {
        let mut parts = line.splitn(2, '\0');
        let (Some(name), Some(email)) = (parts.next(), parts.next()) else {
            continue;
        };
        if email.is_empty() || name.is_empty() {
            continue;
        }
        if seen.insert(email.to_lowercase()) {
            authors.push(CommitAuthor {
                name: name.to_string(),
                email: email.to_string(),
            });
        }
    }
    Ok(authors)
}

#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    repo_path: String,
    title: String,
    body: Option<String>,
    amend: bool,
) -> AppResult<CommitResult> {
    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    args.extend(["-m", title.as_str()]);
    let body = body.filter(|b| !b.trim().is_empty());
    if let Some(body) = &body {
        args.extend(["-m", body.as_str()]);
    }
    run_git_mutating(&state, &repo_path, &args, DEFAULT_TIMEOUT).await?;
    let out = run_git(Some(&repo_path), &["rev-parse", "HEAD"], DEFAULT_TIMEOUT).await?;
    Ok(CommitResult {
        hash: out.stdout_lossy().trim().to_string(),
    })
}

/// Undoes the latest commit, keeping its changes staged (soft reset).
/// A root commit has no parent to reset to, so the branch ref is deleted
/// instead, which leaves the repo in the pre-first-commit state.
#[tauri::command]
pub async fn git_undo_commit(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    let has_parent = run_git_raw(
        Some(&repo_path),
        &["rev-parse", "--verify", "--quiet", "HEAD~1"],
        DEFAULT_TIMEOUT,
    )
    .await?
    .code
        == 0;
    let args: &[&str] = if has_parent {
        &["reset", "--soft", "HEAD~1"]
    } else {
        &["update-ref", "-d", "HEAD"]
    };
    run_git_mutating(&state, &repo_path, args, DEFAULT_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_recent_commits(repo_path: String, limit: u32) -> AppResult<Vec<CommitSummary>> {
    let head_exists = run_git_raw(
        Some(&repo_path),
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?
    .code
        == 0;
    if !head_exists {
        return Ok(Vec::new());
    }

    let limit_arg = limit.to_string();
    let out = run_git(
        Some(&repo_path),
        &[
            "log",
            "-n",
            &limit_arg,
            "--format=%H%x00%s%x00%an%x00%cI",
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let text = out.stdout_lossy();
    let commits = text
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\0');
            Some(CommitSummary {
                hash: parts.next()?.to_string(),
                subject: parts.next()?.to_string(),
                author: parts.next()?.to_string(),
                date: parts.next()?.to_string(),
            })
        })
        .collect();
    Ok(commits)
}
