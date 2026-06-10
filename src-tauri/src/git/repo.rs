use std::path::Path;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::git::runner::{run_git, run_git_raw, DEFAULT_TIMEOUT, NETWORK_TIMEOUT};
use crate::git::types::{GitInfo, RepoInfo};
use crate::state::AppState;

#[tauri::command]
pub async fn check_git_installed(state: State<'_, AppState>) -> AppResult<GitInfo> {
    let info = state
        .git_info
        .get_or_try_init(|| async {
            let out = run_git(None, &["--version"], DEFAULT_TIMEOUT).await?;
            Ok::<_, AppError>(GitInfo {
                version: out.stdout_lossy().trim().to_string(),
            })
        })
        .await?;
    Ok(info.clone())
}

#[tauri::command]
pub async fn validate_repo(path: String) -> AppResult<RepoInfo> {
    if !Path::new(&path).is_dir() {
        return Err(AppError::NotARepo(path));
    }
    let out = run_git_raw(
        Some(&path),
        &["rev-parse", "--show-toplevel"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    if out.code != 0 {
        return Err(AppError::NotARepo(path));
    }
    let root = out.stdout_lossy().trim().to_string();
    if root.is_empty() {
        // bare repository: rev-parse succeeds but prints no toplevel
        return Err(AppError::NotARepo(path));
    }
    // git prints forward slashes; normalize so recents dedupe properly
    #[cfg(windows)]
    let root = root.replace('/', "\\");
    let name = root
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&root)
        .to_string();
    Ok(RepoInfo { root, name })
}

#[tauri::command]
pub async fn clone_repo(
    url: String,
    parent_dir: String,
    dir_name: Option<String>,
) -> AppResult<String> {
    if url.starts_with('-') {
        return Err(AppError::InvalidArgument("invalid clone URL".into()));
    }
    let dir_name = match dir_name {
        Some(name) => name,
        None => default_clone_dir_name(&url)
            .ok_or_else(|| AppError::InvalidArgument("could not infer directory from URL".into()))?,
    };
    if dir_name.starts_with('-') || dir_name.contains(['/', '\\']) {
        return Err(AppError::InvalidArgument("invalid directory name".into()));
    }
    run_git(
        Some(&parent_dir),
        &["clone", "--", &url, &dir_name],
        NETWORK_TIMEOUT,
    )
    .await?;
    let cloned = Path::new(&parent_dir).join(&dir_name);
    Ok(cloned.to_string_lossy().into_owned())
}

fn default_clone_dir_name(url: &str) -> Option<String> {
    let trimmed = url.trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next()?;
    let name = last.trim_end_matches(".git").trim();
    (!name.is_empty()).then(|| name.to_string())
}
