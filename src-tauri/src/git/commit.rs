use tauri::State;

use crate::error::AppResult;
use crate::git::runner::{run_git, run_git_mutating, run_git_raw, DEFAULT_TIMEOUT};
use crate::git::types::{CommitResult, CommitSummary};
use crate::state::AppState;

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
