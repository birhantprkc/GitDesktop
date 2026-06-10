use tauri::State;

use crate::error::AppResult;
use crate::git::runner::{run_git_mutating, NETWORK_TIMEOUT};
use crate::state::AppState;

#[tauri::command]
pub async fn git_fetch(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    run_git_mutating(&state, &repo_path, &["fetch", "--prune"], NETWORK_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_pull(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    run_git_mutating(&state, &repo_path, &["pull", "--ff-only"], NETWORK_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(
    state: State<'_, AppState>,
    repo_path: String,
    set_upstream: bool,
) -> AppResult<()> {
    let args: &[&str] = if set_upstream {
        &["push", "-u", "origin", "HEAD"]
    } else {
        &["push"]
    };
    run_git_mutating(&state, &repo_path, args, NETWORK_TIMEOUT).await?;
    Ok(())
}
