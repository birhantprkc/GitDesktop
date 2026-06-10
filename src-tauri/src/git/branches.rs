use tauri::State;

use crate::error::{AppError, AppResult};
use crate::git::runner::{run_git, run_git_mutating, DEFAULT_TIMEOUT};
use crate::git::types::Branch;
use crate::state::AppState;

fn validate_ref_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::InvalidArgument(format!(
            "invalid branch name: {name}"
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn git_branches(repo_path: String) -> AppResult<Vec<Branch>> {
    let out = run_git(
        Some(&repo_path),
        &[
            "for-each-ref",
            "refs/heads",
            "--format=%(refname:short)%00%(upstream:short)%00%(HEAD)",
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let text = out.stdout_lossy();
    let mut branches = Vec::new();
    for line in text.lines() {
        let mut parts = line.split('\0');
        let (Some(name), upstream, head) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        branches.push(Branch {
            name: name.to_string(),
            is_current: head == Some("*"),
            upstream: upstream.filter(|u| !u.is_empty()).map(str::to_string),
        });
    }
    Ok(branches)
}

#[tauri::command]
pub async fn git_checkout_branch(
    state: State<'_, AppState>,
    repo_path: String,
    name: String,
) -> AppResult<()> {
    validate_ref_name(&name)?;
    run_git_mutating(&state, &repo_path, &["switch", &name], DEFAULT_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_create_branch(
    state: State<'_, AppState>,
    repo_path: String,
    name: String,
    checkout: bool,
) -> AppResult<()> {
    validate_ref_name(&name)?;
    let args: Vec<&str> = if checkout {
        vec!["switch", "-c", &name]
    } else {
        vec!["branch", "--", &name]
    };
    run_git_mutating(&state, &repo_path, &args, DEFAULT_TIMEOUT).await?;
    Ok(())
}
