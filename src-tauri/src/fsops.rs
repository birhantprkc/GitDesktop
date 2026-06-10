use std::path::Path;

use crate::error::{AppError, AppResult};

/// Appends an ignore pattern to the repo root .gitignore (created if absent).
#[tauri::command]
pub async fn append_to_gitignore(repo_path: String, pattern: String) -> AppResult<()> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return Err(AppError::InvalidArgument("empty ignore pattern".into()));
    }
    let path = Path::new(&repo_path).join(".gitignore");
    let mut content = match tokio::fs::read_to_string(&path).await {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(AppError::Io(e)),
    };
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(pattern);
    content.push('\n');
    tokio::fs::write(&path, content).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn reveal_in_explorer(path: String) -> AppResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub async fn open_with_default(path: String) -> AppResult<()> {
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}
