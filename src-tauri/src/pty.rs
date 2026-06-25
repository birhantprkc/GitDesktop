//! In-app **terminal** backend: real PTYs streamed to the frontend's xterm.js.
//!
//! Each terminal is a pseudo-terminal (ConPTY on Windows via `portable-pty`)
//! running either a **host shell** in the session worktree, or — for a container
//! session — a shell *inside* the worktree's test container (reusing the exact
//! run-or-exec + port-publish + cleanup logic the external "Test in container"
//! launcher uses, see `agent_sandbox::container_shell_command`). Output is streamed
//! to the UI over a Tauri `Channel` (base64 chunks, so binary + partial-UTF-8 are
//! safe); input/resize/close come back as commands. PTYs are held in app state
//! keyed by a frontend id and torn down on close (or when the shell exits).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::agent_sandbox::container_shell_command;
use crate::error::{AppError, AppResult};

/// Live PTYs keyed by the frontend-supplied id. `Arc` so the per-PTY reader thread
/// can remove its own entry on exit without going through Tauri's `State`.
#[derive(Default, Clone)]
pub struct PtyState {
    ptys: Arc<Mutex<HashMap<String, PtyHandle>>>,
}

/// Control side of one PTY: the master (resize), a writer (input), and the child
/// (kill). The reader is owned by the streaming thread, not here.
struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOpts {
    /// "host" — a shell in `cwd`; "container" — a shell in the worktree's test
    /// container (publishing `ports`).
    kind: String,
    /// The session worktree path: the cwd for a host shell, and the mount + key
    /// for a container shell.
    cwd: String,
    /// Dev-server ports to publish (container only; ignored for host).
    #[serde(default)]
    ports: Vec<String>,
    cols: u16,
    rows: u16,
}

/// Streamed to the frontend terminal. `Output` carries base64-encoded bytes.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Output { data: String },
    /// The shell process exited; `code` is its exit status when known (surfaced in
    /// the UI so a silent/erroring exit is diagnosable, not just "exited").
    Exit { code: Option<u32> },
}

/// The host shell to run for a "host" terminal — `%COMSPEC%` (cmd.exe) on Windows,
/// `$SHELL` (else `/bin/bash`) elsewhere.
fn host_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Builds the PTY command for the requested kind. Returns the command plus an
/// optional one-line tip to print first (the container port hint).
///
/// `docker` is spawned directly as the PTY child: the vendored portable-pty patch
/// (NULL std handles) makes the child attach to the pseudoconsole, so its TTY check
/// passes and `-t` allocates a real container TTY.
async fn build_command(opts: &PtyOpts) -> AppResult<(CommandBuilder, Option<String>)> {
    if opts.kind == "container" {
        let (bin, args, tip) = container_shell_command(&opts.cwd, &opts.ports).await?;
        let mut cmd = CommandBuilder::new(bin);
        for a in args {
            cmd.arg(a);
        }
        return Ok((cmd, Some(tip)));
    }
    let mut cmd = CommandBuilder::new(host_shell());
    cmd.cwd(&opts.cwd);
    Ok((cmd, None))
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Opens a PTY, starts streaming its output to `on_event`, and registers it under
/// `id`. The frontend writes/resizes/closes it by that id.
#[tauri::command]
pub async fn pty_open(
    state: State<'_, PtyState>,
    id: String,
    opts: PtyOpts,
    on_event: Channel<PtyEvent>,
) -> AppResult<()> {
    let (mut cmd, tip) = build_command(&opts).await?;
    // portable-pty's CommandBuilder already inherits the parent environment, so we
    // only advertise a capable terminal here (re-copying every var is redundant and
    // can introduce odd-cased duplicate Windows vars).
    cmd.env("TERM", "xterm-256color");

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: opts.rows.max(1),
            cols: opts.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Command(format!("failed to open a terminal: {e}")))?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Command(format!("failed to start the shell: {e}")))?;
    // Drop the slave so the child owns the only handle to it (else close can hang).
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Command(format!("terminal reader: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::Command(format!("terminal writer: {e}")))?;

    state.ptys.lock().unwrap().insert(
        id.clone(),
        PtyHandle {
            master: pair.master,
            writer,
            child,
        },
    );

    // A dim first line with the container's reachable URL(s).
    if let Some(tip) = tip {
        let _ = on_event.send(PtyEvent::Output {
            data: encode(format!("\x1b[2m{tip}\x1b[0m\r\n").as_bytes()),
        });
    }

    // Stream output until EOF on a blocking thread, then drop the handle + notify.
    let ptys = state.ptys.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Err(_) => break,
                Ok(n) => {
                    if on_event
                        .send(PtyEvent::Output {
                            data: encode(&buf[..n]),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        // Reap WITHOUT holding the lock or blocking: take the handle out (releasing
        // the lock immediately), then a NON-blocking try_wait for the code. If the
        // child is still alive (the reader stopped early), kill it so it can't
        // orphan. (Holding the lock across a blocking wait() here froze the app.)
        let mut handle = ptys.lock().unwrap().remove(&id);
        let code = handle.as_mut().and_then(|h| match h.child.try_wait() {
            Ok(Some(status)) => Some(status.exit_code()),
            _ => {
                let _ = h.child.kill();
                None
            }
        });
        let _ = on_event.send(PtyEvent::Exit { code });
    });

    Ok(())
}

/// Writes the user's keystrokes (UTF-8) to the PTY.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> AppResult<()> {
    let mut map = state.ptys.lock().unwrap();
    if let Some(h) = map.get_mut(&id) {
        h.writer.write_all(data.as_bytes()).map_err(AppError::Io)?;
        let _ = h.writer.flush();
    }
    Ok(())
}

/// Resizes the PTY when the terminal element resizes.
#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: String, cols: u16, rows: u16) -> AppResult<()> {
    let map = state.ptys.lock().unwrap();
    if let Some(h) = map.get(&id) {
        let _ = h.master.resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        });
    }
    Ok(())
}

/// Kills the shell and drops the PTY (on terminal unmount / dock close). Idempotent.
#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>, id: String) -> AppResult<()> {
    if let Some(mut h) = state.ptys.lock().unwrap().remove(&id) {
        let _ = h.child.kill();
    }
    Ok(())
}
