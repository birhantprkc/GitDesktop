use std::path::Path;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::git::history::validate_hash;
use crate::git::runner::{run_git_mutating, DEFAULT_TIMEOUT};
use crate::state::AppState;

/// Discards working-tree changes for one file. Tracked files are restored
/// from the index; untracked files go to the OS recycle bin.
#[tauri::command]
pub async fn git_discard(
    state: State<'_, AppState>,
    repo_path: String,
    path: String,
    untracked: bool,
) -> AppResult<()> {
    if untracked {
        let full = Path::new(&repo_path).join(&path);
        tauri::async_runtime::spawn_blocking(move || {
            trash::delete(&full).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
        })
        .await
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))??;
        return Ok(());
    }
    run_git_mutating(&state, &repo_path, &["restore", "--", &path], DEFAULT_TIMEOUT).await?;
    Ok(())
}

/// Mixed reset: moves the branch pointer, keeps the working tree.
#[tauri::command]
pub async fn git_reset(
    state: State<'_, AppState>,
    repo_path: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    run_git_mutating(&state, &repo_path, &["reset", "--mixed", &hash], DEFAULT_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_checkout_commit(
    state: State<'_, AppState>,
    repo_path: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    run_git_mutating(&state, &repo_path, &["switch", "--detach", &hash], DEFAULT_TIMEOUT)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn git_revert(
    state: State<'_, AppState>,
    repo_path: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    // -m is not supported here; reverting merge commits needs a parent choice
    run_git_mutating(&state, &repo_path, &["revert", "--no-edit", &hash], DEFAULT_TIMEOUT)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn git_cherry_pick(
    state: State<'_, AppState>,
    repo_path: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    run_git_mutating(&state, &repo_path, &["cherry-pick", &hash], DEFAULT_TIMEOUT).await?;
    Ok(())
}

/// Discards every uncommitted change: untracked files go to the recycle bin,
/// tracked changes are hard-reset to HEAD.
#[tauri::command]
pub async fn git_discard_all(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    use crate::git::runner::{run_git, run_git_raw};

    let status_out = run_git(
        Some(&repo_path),
        &[
            "status",
            "--porcelain=v2",
            "--untracked-files=all",
            "-z",
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let status = crate::git::status::parse_status_v2(&status_out.stdout_lossy());
    let untracked: Vec<String> = status
        .entries
        .iter()
        .filter(|e| e.unstaged == Some(crate::git::types::ChangeKind::Untracked))
        .map(|e| e.path.clone())
        .collect();

    if !untracked.is_empty() {
        let repo = repo_path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for path in untracked {
                let full = Path::new(&repo).join(&path);
                trash::delete(&full)
                    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
            }
            Ok::<(), AppError>(())
        })
        .await
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))??;
    }

    let head_exists = run_git_raw(
        Some(&repo_path),
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?
    .code
        == 0;
    if head_exists {
        run_git_mutating(&state, &repo_path, &["reset", "--hard", "HEAD"], DEFAULT_TIMEOUT)
            .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_stash_all(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    run_git_mutating(
        &state,
        &repo_path,
        &["stash", "push", "--include-untracked"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_pop(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    run_git_mutating(&state, &repo_path, &["stash", "pop"], DEFAULT_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_count(repo_path: String) -> AppResult<u32> {
    let out = crate::git::runner::run_git(
        Some(&repo_path),
        &["stash", "list", "--format=%H"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(out.stdout_lossy().lines().count() as u32)
}

fn validate_branch_arg(name: &str) -> AppResult<()> {
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::InvalidArgument(format!(
            "invalid branch name: {name}"
        )));
    }
    Ok(())
}

/// Merges a branch into the current one. With `squash`, the combined changes
/// are left staged so the user writes the commit themselves. Conflicts leave
/// the repo in a normal merge-conflict state visible in the changes list.
#[tauri::command]
pub async fn git_merge(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    squash: bool,
) -> AppResult<()> {
    validate_branch_arg(&branch)?;
    let args: Vec<&str> = if squash {
        vec!["merge", "--squash", &branch]
    } else {
        vec!["merge", "--no-edit", &branch]
    };
    run_git_mutating(&state, &repo_path, &args, DEFAULT_TIMEOUT).await?;
    Ok(())
}

/// Rebases the current branch onto another. We have no conflict-resolution
/// UI for an in-progress rebase, so on failure the rebase is aborted and the
/// branch left untouched.
#[tauri::command]
pub async fn git_rebase(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
) -> AppResult<()> {
    validate_branch_arg(&branch)?;
    match run_git_mutating(&state, &repo_path, &["rebase", &branch], DEFAULT_TIMEOUT).await {
        Ok(_) => Ok(()),
        Err(AppError::Git { code, stderr }) => {
            let _ = run_git_mutating(
                &state,
                &repo_path,
                &["rebase", "--abort"],
                DEFAULT_TIMEOUT,
            )
            .await;
            Err(AppError::Git {
                code,
                stderr: format!("Rebase hit conflicts and was aborted; your branch is unchanged.\n{stderr}"),
            })
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn git_tag(
    state: State<'_, AppState>,
    repo_path: String,
    name: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid tag name: {name}")));
    }
    run_git_mutating(&state, &repo_path, &["tag", "--", &name, &hash], DEFAULT_TIMEOUT).await?;
    Ok(())
}
