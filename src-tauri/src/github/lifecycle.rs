//! Destructive repo lifecycle: change visibility, transfer ownership, delete.
//! Deliberately separate from the curated settings PATCH — each is irreversible
//! enough to demand its own confirmed call. The UI gates these behind a
//! type-the-name confirmation; delete additionally needs the `delete_repo`
//! OAuth scope (a refresh hint guides the user when it's missing).

use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::github::runner::{run_gh, run_gh_input, GH_NETWORK_TIMEOUT};

/// A GitHub user/org login: alphanumerics + single hyphens, ≤39 chars.
fn validate_owner(login: &str) -> AppResult<()> {
    let ok = !login.is_empty()
        && login.len() <= 39
        && login.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !login.starts_with('-')
        && !login.ends_with('-');
    if !ok {
        return Err(AppError::InvalidArgument(format!(
            "invalid owner: {login}"
        )));
    }
    Ok(())
}

/// Changes repository visibility. `visibility` ∈ public | private | internal
/// (`internal` needs the org to belong to an enterprise — gh's error explains).
#[tauri::command]
pub async fn gh_repo_set_visibility(repo_path: String, visibility: String) -> AppResult<()> {
    if !matches!(visibility.as_str(), "public" | "private" | "internal") {
        return Err(AppError::InvalidArgument(format!(
            "invalid visibility: {visibility}"
        )));
    }
    let body = json!({ "visibility": visibility });
    run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PATCH",
            "repos/{owner}/{repo}",
            "--input",
            "-",
        ],
        &body.to_string(),
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Transfers the repo to `new_owner` (user or org). Returns 202; a transfer to a
/// personal account is pending until the recipient accepts.
#[tauri::command]
pub async fn gh_repo_transfer(
    repo_path: String,
    new_owner: String,
    new_name: Option<String>,
) -> AppResult<()> {
    let new_owner = new_owner.trim();
    validate_owner(new_owner)?;
    let mut body = json!({ "new_owner": new_owner });
    if let Some(name) = new_name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body["new_name"] = json!(name);
    }
    run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "POST",
            "repos/{owner}/{repo}/transfer",
            "--input",
            "-",
        ],
        &body.to_string(),
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Permanently deletes the GitHub repository. Needs the `delete_repo` scope (a
/// missing scope surfaces as gh's error). The local clone is untouched.
#[tauri::command]
pub async fn gh_repo_delete(repo_path: String) -> AppResult<()> {
    run_gh(
        Some(&repo_path),
        &["api", "--method", "DELETE", "repos/{owner}/{repo}"],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}
