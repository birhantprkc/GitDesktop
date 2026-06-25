//! Editable global git config knobs surfaced in Settings → Git. Identity and
//! `init.defaultBranch` live in `commit.rs` (next to the commit-author logic);
//! this module holds the rest.

use crate::error::{AppError, AppResult};
use crate::git::runner::{run_git, run_git_raw, DEFAULT_TIMEOUT};

/// The global line-ending policy (`git config --global core.autocrlf`):
/// `"true"`, `"input"`, `"false"`, or `""` when unset (git then uses its
/// platform default).
#[tauri::command]
pub async fn git_global_autocrlf() -> AppResult<String> {
    Ok(run_git_raw(
        None,
        &["config", "--global", "--get", "core.autocrlf"],
        DEFAULT_TIMEOUT,
    )
    .await
    .ok()
    .filter(|o| o.code == 0)
    .map(|o| o.stdout_lossy().trim().to_string())
    .unwrap_or_default())
}

/// Sets the global line-ending policy. Accepts `"true"`, `"input"`, or
/// `"false"`; a blank value clears it so git reverts to its platform default.
#[tauri::command]
pub async fn git_set_global_autocrlf(value: String) -> AppResult<()> {
    let value = value.trim();
    if value.is_empty() {
        // `--unset` exits 5 when unset; ignore so clearing is idempotent.
        run_git_raw(
            None,
            &["config", "--global", "--unset", "core.autocrlf"],
            DEFAULT_TIMEOUT,
        )
        .await
        .ok();
        return Ok(());
    }
    if !matches!(value, "true" | "input" | "false") {
        return Err(AppError::InvalidArgument(format!(
            "invalid core.autocrlf value: {value}"
        )));
    }
    run_git(
        None,
        &["config", "--global", "core.autocrlf", value],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}
