//! The repo's `.github/dependabot.yml` — what enables Dependabot **version
//! updates** (there's no API for it). Same model as `.github/FUNDING.yml`: we
//! write the local file and let the user review and commit it. We only ever
//! create or delete it (never regenerate over an existing one), so a
//! hand-customized config — groups, ignores, reviewers — is never clobbered.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

fn dependabot_path(repo_path: &str) -> PathBuf {
    Path::new(repo_path).join(".github").join("dependabot.yml")
}

/// The repo's local `.github/dependabot.yml`, or `None` when it doesn't exist.
#[tauri::command]
pub async fn dependabot_get(repo_path: String) -> AppResult<Option<String>> {
    match tokio::fs::read_to_string(dependabot_path(&repo_path)).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Writes `.github/dependabot.yml` into the working tree (creating `.github/`
/// if needed). The user commits it like any other change.
#[tauri::command]
pub async fn dependabot_set(repo_path: String, content: String) -> AppResult<()> {
    let path = dependabot_path(&repo_path);
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(AppError::Io)?;
    }
    tokio::fs::write(&path, content).await.map_err(AppError::Io)?;
    Ok(())
}

/// Removes the local `.github/dependabot.yml` (turns version updates off).
#[tauri::command]
pub async fn dependabot_delete(repo_path: String) -> AppResult<()> {
    match tokio::fs::remove_file(dependabot_path(&repo_path)).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::Io(e)),
    }
}
