//! The Settings → About screen's diagnostics: OS/app info and the status of the
//! external command-line tools several features shell out to (git, gh, glab, and
//! the Claude/Codex agent CLIs). Reuses agent.rs's binary resolver + capture so
//! detection behaves identically to the AI-provider setup (PATH + login-shell
//! fallback, Windows `.cmd` shims, …).

use serde::Serialize;

use crate::agent::{run_capture, resolve_named, AuthStatus, DETECT_TIMEOUT};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// OS family name, e.g. "Windows", "Mac OS", "Ubuntu".
    os: String,
    /// OS version string, or "Unknown" when it can't be determined.
    os_version: String,
    /// The build's target architecture, e.g. "x86_64", "aarch64".
    arch: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    /// Stable id the frontend maps to a label + install link ("git", "gh", …).
    id: String,
    found: bool,
    path: Option<String>,
    /// First line of `--version`, or null if it didn't report one.
    version: Option<String>,
    /// Login state for tools that have one (git is always `Unknown` = N/A).
    authed: AuthStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemHealth {
    system: SystemInfo,
    tools: Vec<ToolStatus>,
}

fn system_info() -> SystemInfo {
    let info = os_info::get();
    SystemInfo {
        os: info.os_type().to_string(),
        os_version: info.version().to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Detect one CLI: resolve it, read `--version`, and (when it has a login) its
/// auth state. `auth_args` is `None` for tools without a login concept (git).
async fn detect(id: &str, names: &[&str], auth_args: Option<&[&str]>) -> ToolStatus {
    let Some(binary) = resolve_named(names, None).await else {
        return ToolStatus {
            id: id.to_string(),
            found: false,
            path: None,
            version: None,
            authed: AuthStatus::Unknown,
        };
    };

    let version = run_capture(&binary, &["--version"], DETECT_TIMEOUT)
        .await
        .ok()
        .filter(|(code, _)| *code == 0)
        // `--version` is often multi-line (gh prints a release-notes URL); the
        // first line is the version we want.
        .and_then(|(_, out)| out.lines().next().map(|l| l.trim().to_string()))
        .filter(|s| !s.is_empty());

    let authed = match auth_args {
        None => AuthStatus::Unknown,
        Some(args) => match run_capture(&binary, args, DETECT_TIMEOUT).await {
            Ok((0, _)) => AuthStatus::Authed,
            Ok(_) => AuthStatus::NotAuthed,
            Err(_) => AuthStatus::Unknown,
        },
    };

    ToolStatus {
        id: id.to_string(),
        found: true,
        path: Some(binary.to_string_lossy().into_owned()),
        version,
        authed,
    }
}

/// OS/app info + the status of every external CLI, for Settings → About. The
/// per-tool detections (each spawns subprocesses) run concurrently.
#[tauri::command]
pub async fn system_health() -> AppResult<SystemHealth> {
    let (git, gh, glab, claude, codex) = tokio::join!(
        detect("git", &["git"], None),
        detect("gh", &["gh"], Some(&["auth", "status"])),
        detect("glab", &["glab"], Some(&["auth", "status"])),
        detect("claude", &["claude"], Some(&["auth", "status"])),
        detect("codex", &["codex"], Some(&["login", "status"])),
    );
    Ok(SystemHealth {
        system: system_info(),
        tools: vec![git, gh, glab, claude, codex],
    })
}
