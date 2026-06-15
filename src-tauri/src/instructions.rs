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

/// Per-repo SHARED branch rules, read from `<repo>/.gitdesktop/branch-rules.json`.
/// Returns the raw file contents (parsed and normalized on the frontend, which
/// owns the schema), or None when the file is absent or empty.
#[tauri::command]
pub async fn read_repo_branch_rules(repo_path: String) -> AppResult<Option<String>> {
    let path = Path::new(&repo_path)
        .join(".gitdesktop")
        .join("branch-rules.json");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) if text.trim().is_empty() => Ok(None),
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Writes the repo's shared branch rules to `<repo>/.gitdesktop/branch-rules.json`,
/// creating the `.gitdesktop` directory if needed. The caller passes the
/// already-serialized (pretty-printed) JSON so the committed file is
/// diff-friendly.
#[tauri::command]
pub async fn write_repo_branch_rules(repo_path: String, contents: String) -> AppResult<()> {
    let dir = Path::new(&repo_path).join(".gitdesktop");
    tokio::fs::create_dir_all(&dir).await.map_err(AppError::Io)?;
    let path = dir.join("branch-rules.json");
    tokio::fs::write(&path, contents).await.map_err(AppError::Io)
}

pub fn parse_patterns(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(String::from)
        .collect()
}
