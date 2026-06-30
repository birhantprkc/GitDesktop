//! The GitLab CLI (`glab`) runner — the GitLab analogue of `github::runner`.
//!
//! Per the locked decision (`docs/multi-provider-support.md` §0), GitLab speaks
//! through `glab`, which mirrors `gh` (same porcelain + a `glab api` escape hatch)
//! and carries auth + self-managed hosts for free. So the GitLab `Forge` impl
//! shells out to `glab` exactly the way the GitHub impl uses `gh`.
//!
//! NOTE: the exact `glab` flags/output here are a first cut and need live
//! validation against a real `glab` (the `--version` / `auth status` contracts);
//! treated as runtime-validate, like the agent-CLI integrations.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use crate::error::{AppError, AppResult};

pub const GLAB_TIMEOUT: Duration = Duration::from_secs(30);
pub const GLAB_NETWORK_TIMEOUT: Duration = Duration::from_secs(120);

pub struct GlabOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: i32,
}

impl GlabOutput {
    pub fn stdout_lossy(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// Runs `glab` and returns raw output regardless of exit code. Only a missing
/// `glab` binary or a timeout is an error here (mirrors `run_gh_raw`).
pub async fn run_glab_raw(
    repo_path: Option<&str>,
    args: &[&str],
    timeout: Duration,
) -> AppResult<GlabOutput> {
    // Resolve glab the way the agent CLIs + the About screen do (`resolve_named`:
    // PATH + known install dirs + the live registry PATH on Windows). A bare
    // `Command::new("glab")` only searches the app process's inherited PATH —
    // which often lacks glab's installer dir even when it's on the user's registry
    // PATH — so it reported "not found" while About showed glab installed.
    let Some(glab) = crate::agent::resolve_named(&["glab"], None).await else {
        return Err(AppError::GlabNotFound);
    };
    let mut cmd = Command::new(&glab);
    cmd.args(args);
    if let Some(repo) = repo_path {
        cmd.current_dir(repo);
    }
    // Keep glab non-interactive + quiet (stdin null already blocks prompts).
    cmd.env("GLAB_PAGER", "")
        .env("PAGER", "")
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0");
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
                AppError::GlabNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    Ok(GlabOutput {
        stdout: output.stdout,
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code: output.status.code().unwrap_or(-1),
    })
}

/// Runs glab, treating any non-zero exit as an error carrying glab's stderr
/// (mirrors `run_gh`). For read ops where a failure should surface, not be empty.
pub async fn run_glab(
    repo_path: Option<&str>,
    args: &[&str],
    timeout: Duration,
) -> AppResult<GlabOutput> {
    let out = run_glab_raw(repo_path, args, timeout).await?;
    if out.code != 0 {
        let msg = out.stderr.trim();
        return Err(AppError::Glab(if msg.is_empty() {
            format!("glab exited with code {}", out.code)
        } else {
            msg.to_string()
        }));
    }
    Ok(out)
}
