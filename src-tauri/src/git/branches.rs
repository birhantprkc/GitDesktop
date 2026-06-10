use tauri::State;

use crate::error::{AppError, AppResult};
use crate::git::runner::{run_git, run_git_mutating, run_git_raw, DEFAULT_TIMEOUT};
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
pub async fn git_rename_branch(
    state: State<'_, AppState>,
    repo_path: String,
    old_name: String,
    new_name: String,
) -> AppResult<()> {
    validate_ref_name(&old_name)?;
    validate_ref_name(&new_name)?;
    run_git_mutating(
        &state,
        &repo_path,
        &["branch", "-m", "--", &old_name, &new_name],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Force-deletes a local branch (the UI confirms first, GitHub Desktop style).
#[tauri::command]
pub async fn git_delete_branch(
    state: State<'_, AppState>,
    repo_path: String,
    name: String,
) -> AppResult<()> {
    validate_ref_name(&name)?;
    run_git_mutating(
        &state,
        &repo_path,
        &["branch", "-D", "--", &name],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// The repository's default branch: origin's HEAD when known, otherwise a
/// local "main"/"master" if one exists.
#[tauri::command]
pub async fn git_default_branch(repo_path: String) -> AppResult<Option<String>> {
    let out = run_git_raw(
        Some(&repo_path),
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    if out.code == 0 {
        let full = out.stdout_lossy().trim().to_string();
        let name = full.strip_prefix("origin/").unwrap_or(&full).to_string();
        if !name.is_empty() {
            return Ok(Some(name));
        }
    }
    for candidate in ["main", "master"] {
        let exists = run_git_raw(
            Some(&repo_path),
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{candidate}"),
            ],
            DEFAULT_TIMEOUT,
        )
        .await?
        .code
            == 0;
        if exists {
            return Ok(Some(candidate.to_string()));
        }
    }
    Ok(None)
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
    start_point: Option<String>,
) -> AppResult<()> {
    validate_ref_name(&name)?;
    if let Some(start) = &start_point {
        crate::git::history::validate_hash(start)?;
    }
    let mut args: Vec<&str> = if checkout {
        vec!["switch", "-c", &name]
    } else {
        vec!["branch", "--", &name]
    };
    if let Some(start) = &start_point {
        args.push(start);
    }
    run_git_mutating(&state, &repo_path, &args, DEFAULT_TIMEOUT).await?;
    Ok(())
}
