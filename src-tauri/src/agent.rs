//! Drives a locally-installed coding-agent CLI (Claude Code, and later Codex)
//! as a non-interactive subprocess to produce a code review, streaming its
//! output back to the frontend over a Tauri channel.
//!
//! The whole point is to reuse the user's existing CLI auth (a Claude/ChatGPT
//! subscription) so a review can run without an API key. Reviews run read-only:
//! Tier 1 disables all tools, so the agent physically can't edit or commit.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub(crate) const DETECT_TIMEOUT: Duration = Duration::from_secs(20);
const REVIEW_TIMEOUT: Duration = Duration::from_secs(300);
/// Repo-aware (Tier 2) runs explore the tree with tools and take longer.
const REVIEW_TIMEOUT_AGENTIC: Duration = Duration::from_secs(600);
/// A write-capable agent session implements a real task, so it gets a much
/// longer budget than a review. Generous for the slice; configurable later.
const SESSION_TIMEOUT: Duration = Duration::from_secs(1800);

/// Which agent CLI to drive. Frontend sends `"claude"` / `"codex"` / `"copilot"`.
/// `Opencode` is a recognized **stub** — detected in About, but its session/review
/// paths aren't wired yet (they return a clear "not yet supported" error).
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentKind {
    Claude,
    Codex,
    Copilot,
    Opencode,
}

impl AgentKind {
    fn binary_names(self) -> &'static [&'static str] {
        match self {
            AgentKind::Claude => &["claude"],
            AgentKind::Codex => &["codex"],
            AgentKind::Copilot => &["copilot"],
            AgentKind::Opencode => &["opencode"],
        }
    }

    /// Args for a non-interactive "am I logged in?" check (exit 0 = authed), or
    /// `None` for a CLI with no such command — Copilot authenticates via the OS
    /// credential store / a token env var, with no status subcommand.
    fn auth_status_args(self) -> Option<&'static [&'static str]> {
        match self {
            AgentKind::Claude => Some(&["auth", "status"]),
            AgentKind::Codex => Some(&["login", "status"]),
            AgentKind::Copilot | AgentKind::Opencode => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            AgentKind::Claude => "Claude Code",
            AgentKind::Codex => "Codex",
            AgentKind::Copilot => "GitHub Copilot",
            AgentKind::Opencode => "opencode",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthStatus {
    Authed,
    NotAuthed,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub authed: AuthStatus,
}

/// Streaming events sent to the frontend over the review channel.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReviewEvent {
    /// A chunk of assistant text to append to the rendered review.
    Delta { text: String },
    /// Transient progress note (Tier 2 tool activity, e.g. "Reading files…").
    Status { text: String },
    /// Terminal success: the full final review text plus run metadata.
    Done {
        text: String,
        is_error: bool,
        cost_usd: Option<f64>,
    },
    /// Terminal failure with a message to surface to the user.
    Error { message: String },
    /// Codex emitted its thread id (turn 1's `thread.started`). The frontend
    /// persists it so a **host** session resumes the *right* thread
    /// (`exec resume <id>`) instead of `--last`, which could grab a concurrent
    /// session sharing `~/.codex`. Ignored for reviews / Claude / container.
    CodexThread { thread_id: String },
}

// --- binary resolution -----------------------------------------------------
//
// A GUI app does not reliably inherit the user's shell PATH, and npm-installed
// CLIs ship a `.cmd` shim on Windows that bare `Command::new("claude")` won't
// resolve. So we search PATH ourselves (honoring PATHEXT) plus the known
// per-tool install dirs, and let the user override with an explicit path.

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".claude").join("bin"));
        dirs.push(home.join(".codex").join("bin"));
        #[cfg(not(windows))]
        {
            // npm with a custom prefix, plus the package/version managers that
            // expose a *stable* bin dir. nvm/fnm don't (their PATH is managed by
            // a shell hook), so those are covered by the login-shell probe.
            dirs.push(home.join(".npm-global").join("bin"));
            dirs.push(home.join(".volta").join("bin"));
            dirs.push(home.join(".asdf").join("shims"));
            dirs.push(home.join(".bun").join("bin"));
            dirs.push(home.join(".linuxbrew").join("bin"));
            // pnpm global bin: ~/Library/pnpm on macOS, ~/.local/share/pnpm on Linux.
            dirs.push(home.join("Library").join("pnpm"));
            dirs.push(home.join(".local").join("share").join("pnpm"));
        }
    }
    #[cfg(windows)]
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm")); // npm global shims
    }
    #[cfg(not(windows))]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/bin")); // Apple Silicon Homebrew
        dirs.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin")); // Linuxbrew
        dirs.push(PathBuf::from("/usr/bin"));
    }
    dirs
}

/// Executable suffixes to try. On Windows this is PATHEXT (`.EXE` before
/// `.CMD`); elsewhere just the bare name.
fn exe_exts() -> Vec<String> {
    #[cfg(windows)]
    {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
            .split(';')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![String::new()]
    }
}

fn probe_dir(dir: &Path, names: &[&str], exts: &[String]) -> Option<PathBuf> {
    for name in names {
        // Prefer extension variants first. On Windows this picks `codex.cmd`
        // over the extension-less `codex` (a bash shim CreateProcess can't run);
        // on Unix `exts` is just [""], so this loop no-ops and we use the bare
        // name below.
        for ext in exts {
            if ext.is_empty() {
                continue;
            }
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        let bare = dir.join(name);
        if bare.is_file() {
            return Some(bare);
        }
    }
    None
}

fn find_executable(names: &[&str]) -> Option<PathBuf> {
    let exts = exe_exts();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            if let Some(found) = probe_dir(&dir, names, &exts) {
                return Some(found);
            }
        }
    }
    for dir in candidate_dirs() {
        if let Some(found) = probe_dir(&dir, names, &exts) {
            return Some(found);
        }
    }
    None
}

/// macOS/Linux fallback: a packaged GUI app inherits launchd's (or a desktop
/// launcher's) minimal PATH, not the user's shell PATH — so a CLI installed by a
/// Node version manager (nvm/fnm/asdf) or under a non-standard prefix is neither
/// on PATH nor in `candidate_dirs`. Ask the user's login+interactive shell to
/// resolve it the way their terminal would. Assumes a POSIX-ish shell
/// (bash/zsh/sh, the overwhelming default); fish and others simply fall back to
/// the explicit-path override in Settings.
#[cfg(not(windows))]
async fn resolve_via_login_shell(names: &[&str]) -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    for name in names {
        let mut cmd = Command::new(&shell);
        // -l sources the profile; -i sources the rc files, where zsh/bash users
        // commonly set PATH (nvm, `brew shellenv`, …). stdin is closed so the
        // shell runs the one command and exits rather than waiting for input.
        cmd.arg("-lic")
            .arg(format!("command -v {name}"))
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let Ok(Ok(out)) = tokio::time::timeout(DETECT_TIMEOUT, cmd.output()).await else {
            continue;
        };
        // rc files may print banners, so scan every line for an absolute path to
        // a real file named like the binary, rather than trusting the first line.
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let candidate = PathBuf::from(line.trim());
            if candidate.is_absolute()
                && candidate.file_name().and_then(|f| f.to_str()) == Some(*name)
                && candidate.is_file()
            {
                return Some(candidate);
            }
        }
    }
    None
}

/// Resolves a binary by candidate `names`: an explicit override if it exists,
/// else a static search of PATH + known dirs, else (non-Windows) the user's
/// login shell. Shared by the agent CLIs and the health-screen tool detection.
pub(crate) async fn resolve_named(names: &[&str], bin_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = bin_path.map(str::trim).filter(|s| !s.is_empty()) {
        let pb = PathBuf::from(p);
        return pb.is_file().then_some(pb);
    }
    if let Some(found) = find_executable(names) {
        return Some(found);
    }
    #[cfg(not(windows))]
    {
        resolve_via_login_shell(names).await
    }
    #[cfg(windows)]
    {
        None
    }
}

/// Resolves the agent CLI's binary (override → PATH → login shell).
async fn resolve(kind: AgentKind, bin_path: Option<&str>) -> Option<PathBuf> {
    resolve_named(kind.binary_names(), bin_path).await
}

// --- detection -------------------------------------------------------------

/// Runs a short command and returns (exit code, stdout+stderr).
pub(crate) async fn run_capture(
    program: &Path,
    args: &[&str],
    timeout: Duration,
) -> AppResult<(i32, String)> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd.kill_on_drop(true);

    let out = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| AppError::Timeout(timeout.as_secs()))?
        .map_err(AppError::Io)?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok((out.status.code().unwrap_or(-1), text))
}

#[tauri::command]
pub async fn agent_detect(kind: AgentKind, bin_path: Option<String>) -> AppResult<AgentInfo> {
    let Some(binary) = resolve(kind, bin_path.as_deref()).await else {
        return Ok(AgentInfo {
            found: false,
            path: None,
            version: None,
            authed: AuthStatus::Unknown,
        });
    };

    let version = run_capture(&binary, &["--version"], DETECT_TIMEOUT)
        .await
        .ok()
        .filter(|(code, _)| *code == 0)
        .map(|(_, out)| out.trim().to_string())
        .filter(|s| !s.is_empty());

    let authed = match kind.auth_status_args() {
        None => AuthStatus::Unknown,
        Some(args) => match run_capture(&binary, args, DETECT_TIMEOUT).await {
            Ok((0, _)) => AuthStatus::Authed,
            Ok(_) => AuthStatus::NotAuthed,
            Err(_) => AuthStatus::Unknown,
        },
    };

    Ok(AgentInfo {
        found: true,
        path: Some(binary.to_string_lossy().into_owned()),
        version,
        authed,
    })
}

// --- review ----------------------------------------------------------------

/// Claude Code review invocation. The diff-bearing user prompt is fed on stdin;
/// this builds everything else. Read-only either way: Tier 1 (`repo_aware =
/// false`) exposes no tools at all; Tier 2 exposes only read tools so the agent
/// can read surrounding code for context but still can't edit, run commands, or
/// hang waiting on a permission prompt.
fn claude_review_args(model: &str, system_prompt: &str, repo_aware: bool) -> Vec<String> {
    let mut args = vec![
        "-p".into(),
        "--system-prompt".into(),
        system_prompt.into(),
        "--output-format".into(),
        "stream-json".into(),
        "--include-partial-messages".into(),
        "--verbose".into(), // required alongside stream-json in print mode
        "--tools".into(),
        if repo_aware {
            "Read,Grep,Glob".into()
        } else {
            String::new()
        },
        "--strict-mcp-config".into(), // no MCP servers (also trims token cost)
        "--no-session-persistence".into(),
    ];
    if !model.trim().is_empty() {
        args.push("--model".into());
        args.push(model.into());
    }
    args
}

/// Claude write-capable *session* invocation. Same streaming shape as a review,
/// but with the write toolset and `bypassPermissions` so it runs full-auto and
/// never hangs on a mid-run permission prompt — safe because the session runs in
/// a throwaway worktree (the sandbox boundary; see `docs/agent-sessions.md`).
/// The task prompt is fed on stdin; the worktree is the process `current_dir`.
///
/// Sessions are multi-turn: turn 1 (`resume = false`) starts a persisted session
/// under `session_id`; each follow-up (`resume = true`) resumes it, so the agent
/// keeps the full conversation AND the worktree's evolving state. Persistence is
/// ON (no `--no-session-persistence`) so `--resume` can find the transcript; the
/// system prompt is set only on turn 1 (the resumed session already carries it).
fn claude_session_args(
    model: &str,
    system_prompt: &str,
    session_id: &str,
    resume: bool,
) -> Vec<String> {
    let mut args = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--include-partial-messages".into(),
        "--verbose".into(),
        "--tools".into(),
        "Read,Grep,Glob,Edit,Write,Bash".into(),
        "--permission-mode".into(),
        "bypassPermissions".into(),
        "--strict-mcp-config".into(),
    ];
    if resume {
        args.push("--resume".into());
        args.push(session_id.into());
    } else {
        args.push("--session-id".into());
        args.push(session_id.into());
        args.push("--system-prompt".into());
        args.push(system_prompt.into());
    }
    if !model.trim().is_empty() {
        args.push("--model".into());
        args.push(model.into());
    }
    args
}

/// Codex write-capable *session* invocation. Two confinement shapes:
///
/// - **Host (`container=false`):** confine the agent's writes to the worktree with
///   Codex's *own* OS sandbox — `-s workspace-write` (macOS/Linux enforce it via
///   Seatbelt/Landlock; Windows needs the unelevated restricted-token sandbox, so
///   `-c windows.sandbox="unelevated"`, which needs no admin/reboot). `exec` is
///   non-interactive so approval is already "never". Verified 2026-06-22:
///   in-worktree writes land, out-of-worktree escapes are denied.
/// - **Container (`container=true`):** the kernel is the boundary, so the full-bypass
///   flag is safe and is the only mode that writes (the host workspace-write sandbox
///   inside the container would just confine to the bind-mount anyway).
///
/// The task goes on stdin (`-`); `--skip-git-repo-check` because the worktree's
/// `.git` is a pointer file (in-container it's dangling; on host the main repo
/// drives git either way). Multi-turn: each session has its own dedicated home +
/// cwd, so `exec resume --last` continues it without us tracking a thread id.
fn codex_session_args(
    model: &str,
    resume: bool,
    container: bool,
    thread_id: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["exec".into()];
    if resume {
        args.push("resume".into());
        // A container session has a dedicated home, so `--last` is unambiguous. A
        // host session shares `~/.codex`, so resume the *specific* thread captured
        // from turn 1 — `--last` could grab a concurrent session.
        match (container, thread_id) {
            (false, Some(id)) => args.push(id.into()),
            _ => args.push("--last".into()),
        }
    }
    if container {
        args.push("--dangerously-bypass-approvals-and-sandbox".into());
    } else {
        // Host: confine writes to the worktree via Codex's own OS sandbox. `exec`
        // is non-interactive, so approval is already "never" (no `-a` flag exists).
        args.push("-s".into());
        args.push("workspace-write".into());
        // Let the agent's shell commands reach the network (npm/pip/git fetch);
        // filesystem confinement is the property we enforce here. Default-on also
        // keeps platforms consistent (Windows `unelevated` is filesystem-only, so
        // network is open there regardless).
        args.push("-c".into());
        args.push("sandbox_workspace_write.network_access=true".into());
        if cfg!(target_os = "windows") {
            // Select the unelevated restricted-token sandbox, else `workspace-write`
            // silently degrades to read-only on Windows.
            args.push("-c".into());
            args.push("windows.sandbox=\"unelevated\"".into());
        }
    }
    args.push("--skip-git-repo-check".into());
    args.push("--json".into());
    if !model.trim().is_empty() {
        args.push("-m".into());
        args.push(model.into());
    }
    args.push("-".into());
    args
}

/// GitHub Copilot CLI write-capable *session* invocation (host only for now —
/// Copilot's creds live in the OS keychain, not a mountable file, so the container
/// tier is a follow-up). Unlike Claude/Codex the prompt is an **argument**
/// (`-p <text>`), not stdin, so the caller passes it here and feeds empty stdin.
///
/// Confinement: `--add-dir <worktree>` (with NO `--allow-all-paths`) restricts the
/// file tools to the worktree — verified: in-worktree writes land, escapes denied.
/// `--allow-all-tools` is required for non-interactive (`-p`) runs. A shell command
/// could still escape, so the host tier is "soft" (like Claude); the worktree's git
/// isolation is the hard guarantee. Multi-turn is deterministic: `--session-id
/// <uuid>` sets the id on turn 1, `--resume <uuid>` continues it (context retained).
fn copilot_session_args(
    model: &str,
    session_id: &str,
    resume: bool,
    worktree: &str,
    prompt: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        prompt.into(),
        "--output-format".into(),
        "json".into(),
        "--no-color".into(),
        "--allow-all-tools".into(),
        "--add-dir".into(),
        worktree.into(),
    ];
    if resume {
        args.push("--resume".into());
        args.push(session_id.into());
    } else {
        args.push("--session-id".into());
        args.push(session_id.into());
    }
    if !model.trim().is_empty() {
        args.push("--model".into());
        args.push(model.into());
    }
    args
}

/// GitHub Copilot CLI **read-only** review invocation. Like the session, the prompt
/// (system + diff) is an argument (`-p`), not stdin. No tool flags (so no
/// `--allow-all-tools`) → the agent analyzes the diff carried in the prompt without
/// writing or running commands — verified: a no-tools `-p` review completes cleanly.
/// Repo-aware (Tier 2) reads of surrounding files would need a read-tool allowlist,
/// a follow-up; for now Copilot review is always diff-only.
fn copilot_review_args(model: &str, prompt: &str) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        prompt.into(),
        "--output-format".into(),
        "json".into(),
        "--no-color".into(),
    ];
    if !model.trim().is_empty() {
        args.push("--model".into());
        args.push(model.into());
    }
    args
}

/// Friendly progress label for a Claude Tier-2 tool call.
fn tool_status(name: &str) -> String {
    match name {
        "Read" => "Reading files…".to_string(),
        "Grep" => "Searching code…".to_string(),
        "Glob" => "Finding files…".to_string(),
        other => format!("Using {other}…"),
    }
}

/// Codex `exec` runs as a read-only agent — there is no diff-only mode, it
/// always explores via shell read commands. Globals (`--cd`/`-a`/`-s`/`-m`)
/// must precede `exec`; the prompt is read from stdin via the `-` sentinel.
fn codex_review_args(model: &str, repo_path: &str) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--cd".into(),
        repo_path.into(),
        "--ask-for-approval".into(),
        "never".into(), // no approval path ⇒ writes/network denied, never prompts
        "--sandbox".into(),
        "read-only".into(),
    ];
    if !model.trim().is_empty() {
        args.push("-m".into());
        args.push(model.into());
    }
    args.push("exec".into());
    args.push("--json".into());
    args.push("-".into());
    args
}

/// Friendly progress label for a Codex shell command (it reads files by running
/// `Get-Content`/`cat`/`rg`/… in the read-only sandbox).
fn codex_command_status(cmd: &str) -> String {
    let lower = cmd.to_lowercase();
    if lower.contains("get-content") || lower.contains("cat ") || lower.contains("type ") {
        "Reading files…".to_string()
    } else if lower.contains("rg ")
        || lower.contains("grep")
        || lower.contains("select-string")
    {
        "Searching code…".to_string()
    } else if lower.contains("get-childitem") || lower.contains("ls ") || lower.contains("dir ") {
        "Listing files…".to_string()
    } else {
        "Inspecting the repo…".to_string()
    }
}

/// Parses one line of Codex `exec --json` (JSONL). Accumulates the latest
/// `agent_message` into `last_message` (the final one is the review) and emits
/// `Done` at the terminal `turn.completed`.
fn parse_codex_line(
    line: &str,
    saw_terminal: &mut bool,
    last_message: &mut String,
) -> Option<ReviewEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    match v.get("type")?.as_str()? {
        "thread.started" => v
            .get("thread_id")
            .and_then(|t| t.as_str())
            .map(|id| ReviewEvent::CodexThread {
                thread_id: id.to_string(),
            }),
        "item.started" => {
            let item = v.get("item")?;
            if item.get("type")?.as_str()? == "command_execution" {
                let cmd = item.get("command").and_then(|c| c.as_str()).unwrap_or("");
                return Some(ReviewEvent::Status {
                    text: codex_command_status(cmd),
                });
            }
            None
        }
        "item.completed" => {
            let item = v.get("item")?;
            if item.get("type")?.as_str()? == "agent_message" {
                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                    *last_message = text.to_string();
                }
            }
            None // codex emits whole messages, not deltas; surface at turn end
        }
        "turn.completed" => {
            *saw_terminal = true;
            Some(ReviewEvent::Done {
                text: std::mem::take(last_message),
                is_error: false,
                cost_usd: None,
            })
        }
        "turn.failed" => {
            *saw_terminal = true;
            Some(ReviewEvent::Error {
                message: "Codex review failed — see the Codex CLI for details.".to_string(),
            })
        }
        "error" => {
            *saw_terminal = true;
            Some(ReviewEvent::Error {
                message: v
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Codex reported an error.")
                    .to_string(),
            })
        }
        _ => None,
    }
}

/// Parses one line of GitHub Copilot CLI `--output-format json` (JSONL). Streams
/// `assistant.message_delta.deltaContent` as narration, keeps the latest
/// `assistant.message.content` as the authoritative final text, and emits `Done` at
/// the terminal `result` (whose `exitCode` decides success). Setup / MCP / skills /
/// reasoning / turn-marker events are ignored.
fn parse_copilot_line(
    line: &str,
    saw_terminal: &mut bool,
    last_message: &mut String,
) -> Option<ReviewEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    match v.get("type")?.as_str()? {
        "assistant.message_delta" => v
            .get("data")
            .and_then(|d| d.get("deltaContent"))
            .and_then(|t| t.as_str())
            .map(|t| ReviewEvent::Delta { text: t.to_string() }),
        "assistant.message" => {
            if let Some(text) = v
                .get("data")
                .and_then(|d| d.get("content"))
                .and_then(|t| t.as_str())
            {
                *last_message = text.to_string();
            }
            None
        }
        "tool.execution_start" => {
            let name = v
                .get("data")
                .and_then(|d| d.get("name").or_else(|| d.get("tool")))
                .and_then(|t| t.as_str())
                .unwrap_or("a tool");
            Some(ReviewEvent::Status {
                text: format!("Running {name}…"),
            })
        }
        "session.error" => {
            let msg = v
                .get("data")
                .and_then(|d| d.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Copilot reported an error.");
            if last_message.is_empty() {
                *last_message = msg.to_string();
            }
            None // the terminal `result` carries the exit code; surface there
        }
        "result" => {
            *saw_terminal = true;
            let is_error = v.get("exitCode").and_then(|c| c.as_i64()).unwrap_or(0) != 0;
            Some(ReviewEvent::Done {
                text: std::mem::take(last_message),
                is_error,
                cost_usd: None,
            })
        }
        _ => None,
    }
}

/// Parses one NDJSON line of Claude `--output-format stream-json`. Sets
/// `saw_result` when the terminal `result` event arrives.
fn parse_claude_line(line: &str, saw_result: &mut bool) -> Option<ReviewEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    match v.get("type")?.as_str()? {
        "stream_event" => {
            let event = v.get("event")?;
            match event.get("type")?.as_str()? {
                // A tool call begins — surface it as transient progress.
                "content_block_start" => {
                    let block = event.get("content_block")?;
                    if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                        let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("a tool");
                        return Some(ReviewEvent::Status {
                            text: tool_status(name),
                        });
                    }
                    None
                }
                "content_block_delta" => {
                    let delta = event.get("delta")?;
                    if delta.get("type")?.as_str()? == "text_delta" {
                        return Some(ReviewEvent::Delta {
                            text: delta.get("text")?.as_str()?.to_string(),
                        });
                    }
                    None
                }
                _ => None,
            }
        }
        "result" => {
            *saw_result = true;
            Some(ReviewEvent::Done {
                text: v
                    .get("result")
                    .and_then(|s| s.as_str())
                    .unwrap_or_default()
                    .to_string(),
                is_error: v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false),
                cost_usd: v.get("total_cost_usd").and_then(|c| c.as_f64()),
            })
        }
        _ => None,
    }
}

/// Spawns an agent CLI, streams its stdout as `ReviewEvent`s until a terminal
/// event / EOF / cancel / timeout, then emits a final `Error` if no terminal
/// result arrived. Shared by `agent_review` (read-only) and `agent_session`
/// (write-enabled, run in a worktree). `cwd` is the process working directory,
/// `cancel_id` keys the cancel registry, and `noun` colors the failure copy.
#[allow(clippy::too_many_arguments)]
async fn stream_agent(
    state: &AppState,
    kind: AgentKind,
    binary: &Path,
    args: Vec<String>,
    stdin_text: String,
    cwd: &str,
    timeout: Duration,
    cancel_id: &str,
    noun: &str,
    // When the run is wrapped in a container (`binary` = docker/podman), the
    // `(runtime, container name)` to force-remove on cancel/timeout — killing the
    // `run` client alone leaves the engine's container running.
    container_kill: Option<(PathBuf, String)>,
    on_event: &Channel<ReviewEvent>,
) -> AppResult<()> {
    let mut cmd = Command::new(binary);
    cmd.args(args)
        .current_dir(cwd)
        .env("NO_COLOR", "1")
        .env("CLICOLOR", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            AppError::Command(format!("{} CLI not found.", kind.label()))
        } else {
            AppError::Io(e)
        }
    })?;

    // Write the prompt on a detached task so a large diff can't deadlock
    // against stdout filling its pipe while we're still writing stdin.
    if let Some(mut stdin) = child.stdin.take() {
        tokio::spawn(async move {
            let _ = stdin.write_all(stdin_text.as_bytes()).await;
            // Dropping `stdin` here closes the pipe so the CLI sees EOF.
        });
    }

    // Drain stderr concurrently; surfaced only if no terminal result arrives.
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(s) = stderr {
            let _ = BufReader::new(s).read_to_string(&mut buf).await;
        }
        buf
    });

    let stdout = child.stdout.take().expect("stdout was piped");
    let mut lines = BufReader::new(stdout).lines();

    let cancel = state.register_agent_cancel(cancel_id).await;

    let mut saw_result = false;
    let mut last_message = String::new(); // codex: accumulates the final message
    let mut cancelled = false;
    let mut timed_out = false;

    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = &mut deadline => {
                timed_out = true;
                let _ = child.start_kill();
                break;
            }
            _ = cancel.notified() => {
                cancelled = true;
                let _ = child.start_kill();
                break;
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let ev = match kind {
                            AgentKind::Claude => parse_claude_line(&l, &mut saw_result),
                            AgentKind::Codex => {
                                parse_codex_line(&l, &mut saw_result, &mut last_message)
                            }
                            AgentKind::Copilot => {
                                parse_copilot_line(&l, &mut saw_result, &mut last_message)
                            }
                            // Unreachable: opencode errors before it ever streams.
                            AgentKind::Opencode => None,
                        };
                        if let Some(ev) = ev {
                            let _ = on_event.send(ev);
                        }
                    }
                    Ok(None) => break, // EOF: process closed stdout
                    Err(_) => break,
                }
            }
        }
    }

    state.clear_agent_cancel(cancel_id).await;
    let _ = child.wait().await;
    // A killed `docker/podman run` client doesn't stop the container — force-
    // remove it so a cancelled/timed-out agent isn't left running detached.
    if cancelled || timed_out {
        if let Some((runtime, name)) = &container_kill {
            let _ = run_capture(runtime, &["rm", "-f", name], DETECT_TIMEOUT).await;
        }
    }
    let stderr_text = stderr_task.await.unwrap_or_default();

    if cancelled {
        // The frontend tore down its UI on cancel; nothing to emit.
        return Ok(());
    }
    if timed_out {
        let _ = on_event.send(ReviewEvent::Error {
            message: format!("The {noun} timed out after {}s.", timeout.as_secs()),
        });
        return Ok(());
    }
    if !saw_result {
        // No terminal result event — surface stderr. Covers auth/quota
        // failures and the empty-stdout-without-a-TTY class of CLI bugs.
        let msg = stderr_text.trim();
        let _ = on_event.send(ReviewEvent::Error {
            message: if msg.is_empty() {
                format!("The {noun} process ended without producing any output.")
            } else {
                msg.to_string()
            },
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_review(
    state: tauri::State<'_, AppState>,
    kind: AgentKind,
    bin_path: Option<String>,
    model: String,
    system_prompt: String,
    user_prompt: String,
    repo_path: String,
    repo_aware: bool,
    review_id: String,
    on_event: Channel<ReviewEvent>,
) -> AppResult<()> {
    let binary = resolve(kind, bin_path.as_deref()).await.ok_or_else(|| {
        AppError::Command(format!(
            "{} CLI not found. Install it or set its path in Settings.",
            kind.label()
        ))
    })?;

    // Per-kind invocation: Claude carries the system prompt as a flag and the
    // diff on stdin; Codex has no system-prompt flag, so both go on stdin.
    let (args, stdin_text) = match kind {
        AgentKind::Claude => (
            claude_review_args(&model, &system_prompt, repo_aware),
            user_prompt,
        ),
        AgentKind::Codex => (
            codex_review_args(&model, &repo_path),
            format!("{system_prompt}\n\n{user_prompt}"),
        ),
        // Copilot: read-only diff review (no tools). The prompt (system + diff) is
        // an argument, not stdin.
        AgentKind::Copilot => (
            copilot_review_args(&model, &format!("{system_prompt}\n\n{user_prompt}")),
            String::new(),
        ),
        // opencode review isn't wired yet (recognized stub).
        AgentKind::Opencode => {
            return Err(AppError::Command(
                "opencode isn't available for AI review yet — coming soon.".to_string(),
            ));
        }
    };

    // Codex always explores the repo, so it gets the longer agentic budget too.
    let timeout = if repo_aware || matches!(kind, AgentKind::Codex) {
        REVIEW_TIMEOUT_AGENTIC
    } else {
        REVIEW_TIMEOUT
    };
    stream_agent(
        &state, kind, &binary, args, stdin_text, &repo_path, timeout, &review_id, "review", None,
        &on_event,
    )
    .await
}

#[tauri::command]
pub async fn agent_review_cancel(
    state: tauri::State<'_, AppState>,
    review_id: String,
) -> AppResult<()> {
    state.cancel_agent(&review_id).await;
    Ok(())
}

/// Runs one turn of a write-capable agent session: the CLI implements
/// `user_prompt` full-auto inside `worktree_path` (a throwaway worktree — the
/// sandbox boundary). `resume = false` starts the session; `resume = true`
/// continues it (keeping context). Streams the same `ReviewEvent`s as a review;
/// cancel via `agent_review_cancel` with the same `session_id`.
///
/// `agent` picks the CLI. Claude/Codex run on the **host** (worktree-confined:
/// Claude full-auto via `bypassPermissions` — soft until its permission prompt
/// lands; Codex via its own OS sandbox, `-s workspace-write`) or in a **container**
/// (kernel boundary). **Copilot** runs host-only for now (`--add-dir` confines its
/// file tools to the worktree; its creds aren't file-mountable, so the container
/// tier is a follow-up). **opencode** is a recognized stub (errors until wired).
#[tauri::command]
pub async fn agent_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    bin_path: Option<String>,
    // "claude" (default), "codex", or "copilot" ("opencode" is a recognized stub).
    agent: String,
    model: String,
    system_prompt: String,
    user_prompt: String,
    worktree_path: String,
    session_id: String,
    resume: bool,
    // "container" runs the turn inside a Docker/Podman container (worktree-
    // confined); anything else (incl. None) runs it on the host (worktree-only).
    isolation: Option<String>,
    // Codex's thread id captured from turn 1 (`thread.started`), so a *host*
    // session resumes the right thread; None on turn 1 / Claude / container.
    codex_thread_id: Option<String>,
    on_event: Channel<ReviewEvent>,
) -> AppResult<()> {
    // Strict: reject an unknown agent rather than silently coercing it.
    let kind = match agent.as_str() {
        "claude" => AgentKind::Claude,
        "codex" => AgentKind::Codex,
        "copilot" => AgentKind::Copilot,
        "opencode" => AgentKind::Opencode,
        other => {
            return Err(AppError::InvalidArgument(format!(
                "unknown agent: {other:?}"
            )));
        }
    };
    let agent_name = match kind {
        AgentKind::Codex => "codex",
        AgentKind::Claude => "claude",
        AgentKind::Copilot => "copilot",
        AgentKind::Opencode => "opencode",
    };
    let container = isolation.as_deref() == Some("container");

    // opencode is a recognized stub — its session path isn't wired yet.
    if kind == AgentKind::Opencode {
        return Err(AppError::Command(
            "opencode agent sessions aren't supported yet — coming soon.".to_string(),
        ));
    }
    // Copilot runs on the host only for now: its credentials live in the OS
    // keychain (not a mountable file), so the container tier is a follow-up.
    if kind == AgentKind::Copilot && container {
        return Err(AppError::Command(
            "Copilot sessions don't support container isolation yet (its login isn't file-mountable). Turn isolation off in Settings → AI to run Copilot on the host.".to_string(),
        ));
    }

    // The inner CLI invocation + the stdin for this turn. Claude carries the
    // system prompt as a flag; Codex has none, so it's prepended on stdin (turn
    // 1 only — a resumed Codex session already has it in context).
    let (inner, stdin_text) = match kind {
        AgentKind::Claude => (
            claude_session_args(&model, &system_prompt, &session_id, resume),
            user_prompt,
        ),
        AgentKind::Codex => (
            codex_session_args(&model, resume, container, codex_thread_id.as_deref()),
            if resume {
                user_prompt
            } else {
                format!("{system_prompt}\n\n{user_prompt}")
            },
        ),
        // Copilot takes the prompt as an arg (`-p`), not stdin, so stdin is empty.
        AgentKind::Copilot => {
            let prompt = if resume {
                user_prompt
            } else {
                format!("{system_prompt}\n\n{user_prompt}")
            };
            (
                copilot_session_args(&model, &session_id, resume, &worktree_path, &prompt),
                String::new(),
            )
        }
        // Rejected above (stub).
        AgentKind::Opencode => unreachable!("opencode session rejected above"),
    };

    // Container isolation: wrap the same invocation in an ephemeral,
    // worktree-confined container. The agent CLI lives in the image, so we don't
    // resolve a host binary; the runtime drives it.
    if container {
        let (runtime, runtime_name) = crate::agent_sandbox::detect_runtime().await.ok_or_else(|| {
            AppError::Command(if matches!(kind, AgentKind::Codex) {
                // Codex is container-only, so "turn isolation off" isn't an option.
                "Codex sessions need Docker or Podman (they run only in a container). Install and start it, then build the image in Settings → AI — or use Claude instead.".to_string()
            } else {
                "Container isolation is on, but Docker/Podman isn't available. Install/start it or turn isolation off in Settings.".to_string()
            })
        })?;
        if !crate::agent_sandbox::image_present(&runtime).await {
            return Err(AppError::Command(
                "The agent container image isn't built yet. Open Settings → AI and click \"Build image\", then try again.".to_string(),
            ));
        }
        // The image may have been built without this agent (provider selection) —
        // fail clearly instead of a cryptic in-container "command not found".
        if !crate::agent_sandbox::image_has_agent(&runtime, agent_name).await {
            return Err(AppError::Command(format!(
                "The agent image wasn't built with {}. Open Settings → AI, add it under the image's agents, and rebuild.",
                kind.label()
            )));
        }
        // Fail early with a clear message if the agent isn't logged in on the
        // host (its creds are what we mount into the container).
        if !crate::agent_sandbox::host_logged_in(agent_name) {
            return Err(AppError::Command(format!(
                "{} isn't logged in on this machine. Sign in with its CLI first, then start the session.",
                if matches!(kind, AgentKind::Codex) { "Codex" } else { "Claude" }
            )));
        }
        // Defense-in-depth: the worktree is bind-mounted, so never let a `..` in
        // its path widen the mount beyond the intended directory.
        if Path::new(&worktree_path)
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(AppError::InvalidArgument(
                "worktree path must not contain '..'".to_string(),
            ));
        }
        let home = crate::agent_sandbox::seed_session_home(&app, &session_id, agent_name)?;
        let name = crate::agent_sandbox::container_name(&session_id);
        let args = crate::agent_sandbox::build_run_args(
            &runtime_name,
            agent_name,
            &worktree_path,
            &home,
            &name,
            &inner,
        );
        return stream_agent(
            &state,
            kind,
            &runtime,
            args,
            stdin_text,
            &worktree_path,
            SESSION_TIMEOUT,
            &session_id,
            "session",
            Some((runtime.clone(), name)),
            &on_event,
        )
        .await;
    }

    // Host: both agents run worktree-confined — Claude via `bypassPermissions`
    // (soft FS boundary until its permission prompt lands), Codex via its own OS
    // sandbox (`-s workspace-write`; really confines writes — see codex_session_args).
    let binary = resolve(kind, bin_path.as_deref()).await.ok_or_else(|| {
        AppError::Command(format!(
            "{} CLI not found. Install it or set its path in Settings.",
            kind.label()
        ))
    })?;
    stream_agent(
        &state,
        kind,
        &binary,
        inner,
        stdin_text,
        &worktree_path,
        SESSION_TIMEOUT,
        &session_id,
        "session",
        None,
        &on_event,
    )
    .await
}
