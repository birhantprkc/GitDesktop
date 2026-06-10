use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(600);

pub struct GitOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: i32,
}

impl GitOutput {
    pub fn stdout_lossy(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// Runs git and returns the raw output regardless of exit code.
/// Only spawn failures and timeouts are errors.
pub async fn run_git_raw(
    repo_path: Option<&str>,
    args: &[&str],
    timeout: Duration,
) -> AppResult<GitOutput> {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "core.quotePath=false", "-c", "color.ui=false"]);
    cmd.args(args);
    if let Some(repo) = repo_path {
        cmd.current_dir(repo);
    }
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C");
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd.kill_on_drop(true);

    let output = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| AppError::Timeout(timeout.as_secs()))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::GitNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    Ok(GitOutput {
        stdout: output.stdout,
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code: output.status.code().unwrap_or(-1),
    })
}

/// Runs git, treating any non-zero exit code as an error carrying stderr.
pub async fn run_git(
    repo_path: Option<&str>,
    args: &[&str],
    timeout: Duration,
) -> AppResult<GitOutput> {
    let out = run_git_raw(repo_path, args, timeout).await?;
    if out.code != 0 {
        return Err(AppError::Git {
            code: out.code,
            stderr: out.stderr,
        });
    }
    Ok(out)
}

/// Runs a mutating git command under the per-repo lock, retrying once on
/// index.lock contention caused by external tools (editors, other clients).
pub async fn run_git_mutating(
    state: &AppState,
    repo_path: &str,
    args: &[&str],
    timeout: Duration,
) -> AppResult<GitOutput> {
    let lock = state.repo_lock(repo_path).await;
    let _guard = lock.lock().await;
    match run_git(Some(repo_path), args, timeout).await {
        Err(AppError::Git { ref stderr, .. }) if stderr.contains("index.lock") => {
            tokio::time::sleep(Duration::from_millis(300)).await;
            run_git(Some(repo_path), args, timeout).await
        }
        other => other,
    }
}
