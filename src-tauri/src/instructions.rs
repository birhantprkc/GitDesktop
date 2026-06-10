use std::path::Path;

use crate::error::{AppError, AppResult};

/// Per-repo AI instructions, read from `<repo>/.gitdesktop/instructions.md`.
#[tauri::command]
pub async fn read_repo_instructions(repo_path: String) -> AppResult<Option<String>> {
    let path = Path::new(&repo_path)
        .join(".gitdesktop")
        .join("instructions.md");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => {
            let trimmed = text.trim();
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Per-repo AI ignore patterns from `<repo>/.gitdesktop/aiignore`
/// (gitignore-style globs, one per line, # comments).
#[tauri::command]
pub async fn read_repo_ai_ignore(repo_path: String) -> AppResult<Vec<String>> {
    let path = Path::new(&repo_path).join(".gitdesktop").join("aiignore");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => Ok(parse_patterns(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(AppError::Io(e)),
    }
}

pub fn parse_patterns(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(String::from)
        .collect()
}
