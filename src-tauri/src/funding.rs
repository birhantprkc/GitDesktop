//! The repo's `.github/FUNDING.yml` — the file behind GitHub's "Sponsor" button.
//! We edit it as a LOCAL file in the working tree: write it and let the user
//! review and commit it through the normal flow, rather than committing to the
//! default branch behind their back. (YAML shaping lives in the frontend.)

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

fn funding_path(repo_path: &str) -> PathBuf {
    Path::new(repo_path).join(".github").join("FUNDING.yml")
}

/// The repo's local `.github/FUNDING.yml`, or `None` when it doesn't exist.
#[tauri::command]
pub async fn funding_get(repo_path: String) -> AppResult<Option<String>> {
    match tokio::fs::read_to_string(funding_path(&repo_path)).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Writes `.github/FUNDING.yml` into the working tree (creating `.github/` if
/// needed). The user commits it like any other change — we never commit for them.
#[tauri::command]
pub async fn funding_set(repo_path: String, content: String) -> AppResult<()> {
    let path = funding_path(&repo_path);
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(AppError::Io)?;
    }
    tokio::fs::write(&path, content).await.map_err(AppError::Io)?;
    Ok(())
}

/// Removes the local `.github/FUNDING.yml` (a deletion the user then commits).
#[tauri::command]
pub async fn funding_delete(repo_path: String) -> AppResult<()> {
    match tokio::fs::remove_file(funding_path(&repo_path)).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::Io(e)),
    }
}
