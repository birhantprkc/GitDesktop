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

const DETECT_TIMEOUT: Duration = Duration::from_secs(20);
const REVIEW_TIMEOUT: Duration = Duration::from_secs(300);
/// Repo-aware (Tier 2) runs explore the tree with tools and take longer.
const REVIEW_TIMEOUT_AGENTIC: Duration = Duration::from_secs(600);

/// Which agent CLI to drive. Frontend sends `"claude"` / `"codex"`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentKind {
    Claude,
    Codex,
}

impl AgentKind {
    fn binary_names(self) -> &'static [&'static str] {
        match self {
            AgentKind::Claude => &["claude"],
            AgentKind::Codex => &["codex"],
        }
    }

    /// Args for a non-interactive "am I logged in?" check (exit 0 = authed).
    fn auth_status_args(self) -> &'static [&'static str] {
        match self {
            AgentKind::Claude => &["auth", "status"],
            AgentKind::Codex => &["login", "status"],
        }
    }

    fn label(self) -> &'static str {
        match self {
            AgentKind::Claude => "Claude Code",
            AgentKind::Codex => "Codex",
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
        dirs.push(home.join(".npm-global").join("bin"));
    }
    #[cfg(windows)]
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm")); // npm global shims
    }
    #[cfg(not(windows))]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
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

/// Resolves the binary to run: an explicit override if it exists, else search.
fn resolve(kind: AgentKind, bin_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = bin_path.map(str::trim).filter(|s| !s.is_empty()) {
        let pb = PathBuf::from(p);
        return pb.is_file().then_some(pb);
    }
    find_executable(kind.binary_names())
}

// --- detection -------------------------------------------------------------

/// Runs a short command and returns (exit code, stdout+stderr).
async fn run_capture(program: &Path, args: &[&str], timeout: Duration) -> AppResult<(i32, String)> {
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
    let Some(binary) = resolve(kind, bin_path.as_deref()) else {
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

    let authed = match run_capture(&binary, kind.auth_status_args(), DETECT_TIMEOUT).await {
        Ok((0, _)) => AuthStatus::Authed,
        Ok(_) => AuthStatus::NotAuthed,
        Err(_) => AuthStatus::Unknown,
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
    let binary = resolve(kind, bin_path.as_deref()).ok_or_else(|| {
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
    };

    let mut cmd = Command::new(&binary);
    cmd.args(args)
        .current_dir(&repo_path)
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

    // Drain stderr concurrently; surfaced only if no `result` event arrives.
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

    let cancel = state.register_agent_cancel(&review_id).await;

    let mut saw_result = false;
    let mut last_message = String::new(); // codex: accumulates the final review
    let mut cancelled = false;
    let mut timed_out = false;

    // Codex always explores the repo, so it gets the longer agentic budget too.
    let timeout = if repo_aware || matches!(kind, AgentKind::Codex) {
        REVIEW_TIMEOUT_AGENTIC
    } else {
        REVIEW_TIMEOUT
    };
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

    state.clear_agent_cancel(&review_id).await;
    let _ = child.wait().await;
    let stderr_text = stderr_task.await.unwrap_or_default();

    if cancelled {
        // The frontend tore down its UI on cancel; nothing to emit.
        return Ok(());
    }
    if timed_out {
        let _ = on_event.send(ReviewEvent::Error {
            message: format!("Review timed out after {}s.", timeout.as_secs()),
        });
        return Ok(());
    }
    if !saw_result {
        // No terminal `result` event — surface stderr. Covers auth/quota
        // failures and the empty-stdout-without-a-TTY class of CLI bugs.
        let msg = stderr_text.trim();
        let _ = on_event.send(ReviewEvent::Error {
            message: if msg.is_empty() {
                "The review process ended without producing any output.".to_string()
            } else {
                msg.to_string()
            },
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_review_cancel(
    state: tauri::State<'_, AppState>,
    review_id: String,
) -> AppResult<()> {
    state.cancel_agent(&review_id).await;
    Ok(())
}
