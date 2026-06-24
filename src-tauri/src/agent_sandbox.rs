//! Optional **container isolation** for write-capable agent sessions.
//!
//! By default a session runs the agent CLI full-auto on the host, confined only
//! by its throwaway git worktree (a soft boundary). When the user opts into
//! container isolation and Docker/Podman is available, we instead run the same
//! CLI inside an ephemeral `--rm` container with **only** the worktree
//! bind-mounted — so the agent's writes are confined to that mount by the kernel,
//! and full-auto bypass is safe inside. The host still drives git (the worktree
//! `.git` is a file-pointer that doesn't resolve in-container), so commit/diff/
//! Keep-Discard are unchanged.
//!
//! Auth: each agent CLI's credentials are a file (Claude `~/.claude/
//! .credentials.json`, Codex `~/.codex/auth.json`, opencode optionally
//! `~/.local/share/opencode/auth.json`), so we seed a **copy** into a per-session,
//! per-agent home that's mounted read-write at the CLI's dir — the container
//! authenticates with no API key, can refresh its own token, and never sees the
//! host's real config. The home persists across a session's turns (so `--resume`
//! finds the transcript) and is removed on discard/delete. **opencode needs no
//! creds for its free hosted models**, so its container runs keyless out of the box.
//! **Copilot has no mountable creds file** (its login lives in the OS keychain), so
//! its container authenticates from a GitHub token (`gh auth token`) passed by env
//! (`COPILOT_GITHUB_TOKEN`), never a file.
//!
//! Claude, opencode, and Copilot run on the host or in a container; **Codex is
//! container-only** (its host `workspace-write` is trust-gated, but full-bypass is
//! safe in the box). Validated end-to-end by spike + live runs (Codex 2026-06-22,
//! opencode 2026-06-23); see docs/agent-sandbox-docker.md.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::agent::{resolve_named, run_capture, DETECT_TIMEOUT};
use crate::error::{AppError, AppResult};

/// The managed image: a small Node base with the user-selected agent CLIs, run as
/// the non-root `node` user (the CLIs refuse full-bypass as root). A single fixed
/// tag, rebuilt in place when the user changes the Node version or providers; the
/// built config is recorded as the `gdconfig` image LABEL so detect can tell
/// whether the image matches the current selection (else the UI prompts a rebuild).
pub const IMAGE: &str = "gitdesktop-agent:latest";
const BUILD_TIMEOUT: Duration = Duration::from_secs(600);

/// npm package for a **container-capable** agent. `None` for an agent we can't run
/// in the container.
fn agent_npm_package(agent: &str) -> Option<&'static str> {
    match agent {
        "claude" => Some("@anthropic-ai/claude-code"),
        "codex" => Some("@openai/codex"),
        "opencode" => Some("opencode-ai"),
        // Copilot has no mountable creds file (its login lives in the OS keychain),
        // so a container session authenticates from a `gh auth token` passed by env
        // — see `build_run_args` / the `agent_session` container branch.
        "copilot" => Some("@github/copilot"),
        _ => None,
    }
}

/// The container dir an agent's seeded home mounts at — where it keeps its creds +
/// session store. opencode uses an XDG data dir (its SQLite session db + optional
/// auth.json live in `~/.local/share/opencode`), not a top-level dotdir.
fn agent_dotdir(agent: &str) -> &'static str {
    match agent {
        "codex" => "/home/node/.codex",
        "opencode" => "/home/node/.local/share/opencode",
        // Copilot keeps its session-store.db (for `--resume`) + config here; no creds
        // file (it authenticates from the env token), but the dir still mounts so the
        // session db survives across a session's turns.
        "copilot" => "/home/node/.copilot",
        _ => "/home/node/.claude",
    }
}

/// Where the in-container CLI reads GLOBAL skills — Claude reads only
/// `~/.claude/skills` (the host junctions it to the canonical store), every other
/// agent reads the vendor-neutral `~/.agents/skills` directly.
fn skills_target(agent: &str) -> &'static str {
    match agent {
        "claude" => "/home/node/.claude/skills",
        _ => "/home/node/.agents/skills",
    }
}

/// Digits-only Node major version (e.g. "24"), guarded so it can't inject into the
/// Dockerfile or the image label.
fn valid_node_version(v: &str) -> bool {
    !v.is_empty() && v.len() <= 3 && v.bytes().all(|b| b.is_ascii_digit())
}

/// A deterministic signature of the image config, stored as the `gdconfig` image
/// label — detect compares it to the current selection to decide "matches" vs
/// "rebuild needed". Providers are sorted + de-duped so order doesn't matter.
fn config_signature(node_version: &str, providers: &[String]) -> String {
    let mut p: Vec<&str> = providers.iter().map(String::as_str).collect();
    p.sort_unstable();
    p.dedup();
    format!("node{node_version}-{}", p.join("-"))
}

/// Renders the Dockerfile for the chosen Node version + agent providers. Validates
/// inputs (digits-only version; every provider container-capable; ≥1 provider).
/// `node:<ver>-slim` lacks ca-certificates, so the agents' TLS to their APIs fails
/// ("no native root CA certificates found") — install them.
fn render_dockerfile(node_version: &str, providers: &[String]) -> AppResult<String> {
    if !valid_node_version(node_version) {
        return Err(AppError::InvalidArgument(format!(
            "invalid Node version: {node_version:?}"
        )));
    }
    let mut pkgs: Vec<&str> = Vec::new();
    let mut dirs: Vec<&str> = Vec::new();
    for a in providers {
        let pkg = agent_npm_package(a).ok_or_else(|| {
            AppError::InvalidArgument(format!("agent can't run in a container: {a:?}"))
        })?;
        pkgs.push(pkg);
        dirs.push(agent_dotdir(a));
    }
    pkgs.sort_unstable();
    pkgs.dedup();
    dirs.sort_unstable();
    dirs.dedup();
    if pkgs.is_empty() {
        return Err(AppError::InvalidArgument(
            "select at least one agent to install in the image".into(),
        ));
    }
    let pkgs = pkgs.join(" ");
    let dirs = dirs.join(" ");
    // `chown` the WHOLE home, not just `{dirs}`: opencode's dotdir is several levels
    // deep (`~/.local/share/opencode`), so `mkdir -p` leaves the intermediate
    // `~/.local` root-owned — and then `node` can't create the sibling XDG dirs
    // opencode needs at runtime (`~/.local/state`), failing with EACCES. Chowning
    // `/home/node` (nearly empty in the slim image) is a harmless superset for the
    // top-level Claude/Codex dotdirs and fixes the deep opencode case. Verified live.
    Ok(format!(
        "FROM node:{node_version}-slim\nRUN apt-get update \\\n && apt-get install -y --no-install-recommends ca-certificates \\\n && rm -rf /var/lib/apt/lists/* \\\n && npm install -g {pkgs} \\\n && mkdir -p {dirs} \\\n && chown -R node:node /home/node\nUSER node\nWORKDIR /workspace\n"
    ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerStatus {
    /// "docker" | "podman", or null if neither is on PATH.
    pub runtime: Option<String>,
    /// The runtime is installed AND its daemon answers (`<rt> version` exit 0).
    pub ready: bool,
    /// The managed agent image has been built (any config).
    pub image_present: bool,
    /// The built image's `gdconfig` label matches the requested Node version +
    /// providers — `false` while `image_present` is true means "rebuild to apply".
    pub image_matches: bool,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// The host credentials file an agent's container home is seeded from. `None` for an
/// agent with no mountable creds file — Copilot (login is in the OS keychain; it auths
/// from an env token instead) and opencode when it has no `auth.json` (free models).
fn host_creds(agent: &str) -> Option<PathBuf> {
    // Copilot has no creds file to seed — its container authenticates from a GitHub
    // token passed by env, not a mounted file.
    if agent == "copilot" {
        return None;
    }
    home_dir().map(|h| match agent {
        "codex" => h.join(".codex").join("auth.json"),
        "opencode" => h
            .join(".local")
            .join("share")
            .join("opencode")
            .join("auth.json"),
        _ => h.join(".claude").join(".credentials.json"),
    })
}

/// Whether the agent CLI is logged in on the host (its creds file exists) — so a
/// container session can fail early with a clear "log in first" message instead
/// of a cryptic in-container auth error.
pub(crate) fn host_logged_in(agent: &str) -> bool {
    host_creds(agent).is_some_and(|p| p.is_file())
}

/// The host's GLOBAL skills store — the vendor-neutral canonical `~/.agents/skills`
/// — if it exists, to bind-mount read-only into a container session. Without it, a
/// container only sees PROJECT skills carried in the mounted worktree, so a nudge to
/// a global skill (which the host CLI would auto-load from home) can't resolve. We
/// source the canonical dir (all real subdirs); a Claude-only skill living solely in
/// a real `~/.claude/skills` entry isn't covered (a follow-up if it's ever needed).
pub(crate) fn global_skills_dir() -> Option<PathBuf> {
    home_dir()
        .map(|h| h.join(".agents").join("skills"))
        .filter(|p| p.is_dir())
}

/// Finds Docker or Podman on PATH (Docker preferred). Returns (binary, name).
pub(crate) async fn detect_runtime() -> Option<(PathBuf, String)> {
    if let Some(bin) = resolve_named(&["docker"], None).await {
        return Some((bin, "docker".to_string()));
    }
    if let Some(bin) = resolve_named(&["podman"], None).await {
        return Some((bin, "podman".to_string()));
    }
    // Windows: Podman Desktop installs here but isn't on PATH until the app is
    // relaunched after install — check the known location so a just-installed
    // Podman is found without a restart.
    #[cfg(windows)]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local)
            .join("Programs")
            .join("Podman")
            .join("podman.exe");
        if p.is_file() {
            return Some((p, "podman".to_string()));
        }
    }
    None
}

/// True when `<rt> version` exits 0 (engine reachable, not just the client).
async fn runtime_ready(bin: &Path) -> bool {
    matches!(
        run_capture(bin, &["version"], DETECT_TIMEOUT).await,
        Ok((0, _))
    )
}

pub(crate) async fn image_present(bin: &Path) -> bool {
    matches!(
        run_capture(bin, &["image", "inspect", IMAGE], DETECT_TIMEOUT).await,
        Ok((0, _))
    )
}

/// Reads the built image's `gdconfig` label (`None` if the image/label is absent).
async fn image_config_label(bin: &Path) -> Option<String> {
    match run_capture(
        bin,
        &[
            "image",
            "inspect",
            "--format",
            "{{index .Config.Labels \"gdconfig\"}}",
            IMAGE,
        ],
        DETECT_TIMEOUT,
    )
    .await
    {
        Ok((0, out)) => Some(out.trim().to_string()),
        _ => None,
    }
}

/// Whether the built image includes `agent` (per its `gdconfig` label) — lets a
/// container session fail clearly if the user left that agent out of the image. An
/// old image with no label is treated as "has it" (don't block; the run will tell).
pub(crate) async fn image_has_agent(bin: &Path, agent: &str) -> bool {
    match image_config_label(bin).await {
        Some(sig) if !sig.is_empty() => sig.split('-').any(|t| t == agent),
        _ => true,
    }
}

/// Reports whether container isolation is usable on this machine and whether the
/// agent image still needs building. Drives the Settings affordance.
#[tauri::command]
pub async fn agent_container_detect(
    node_version: String,
    providers: Vec<String>,
) -> AppResult<ContainerStatus> {
    let Some((bin, name)) = detect_runtime().await else {
        return Ok(ContainerStatus {
            runtime: None,
            ready: false,
            image_present: false,
            image_matches: false,
        });
    };
    let ready = runtime_ready(&bin).await;
    // Only probe the image if the engine is up (inspect needs the daemon).
    let image_present = ready && image_present(&bin).await;
    let image_matches = image_present
        && image_config_label(&bin).await.as_deref()
            == Some(config_signature(&node_version, &providers).as_str());
    Ok(ContainerStatus {
        runtime: Some(name),
        ready,
        image_present,
        image_matches,
    })
}

/// Builds the managed agent image (`<rt> build -t IMAGE <ctx>` from a tiny temp
/// context dir). Idempotent + cached by the engine; a few minutes on first run.
#[tauri::command]
pub async fn agent_container_prepare(
    node_version: String,
    providers: Vec<String>,
    force: bool,
) -> AppResult<()> {
    let (bin, _) = detect_runtime()
        .await
        .ok_or_else(|| AppError::Command("Docker or Podman is not installed.".into()))?;
    if !runtime_ready(&bin).await {
        return Err(AppError::Command(
            "Docker/Podman is installed but its engine isn't running. Start it and try again."
                .into(),
        ));
    }

    // Render + validate the Dockerfile for the selected Node version + providers,
    // and stamp the config as a label so detect can spot a stale image.
    let dockerfile = render_dockerfile(&node_version, &providers)?;
    let label = format!("gdconfig={}", config_signature(&node_version, &providers));

    // Write the Dockerfile into an empty temp context dir and build from it,
    // rather than piping it on stdin — `build -` reads stdin differently across
    // Docker and Podman, so a real (tiny) context dir is the portable form.
    let ctx = std::env::temp_dir().join(format!("gd-agent-build-{}", std::process::id()));
    std::fs::create_dir_all(&ctx)?;
    std::fs::write(ctx.join("Dockerfile"), &dockerfile)?;
    let ctx_str = ctx.to_string_lossy().into_owned();

    let mut build_args: Vec<String> =
        vec!["build".into(), "-t".into(), IMAGE.into(), "--label".into(), label];
    // Rebuild ("update") pulls a fresh base + reinstalls the CLIs rather than
    // reusing cached layers, so newer CLI / Node releases are actually picked up.
    if force {
        build_args.push("--no-cache".into());
        build_args.push("--pull".into());
    }
    build_args.push(ctx_str);

    let mut cmd = Command::new(&bin);
    cmd.args(&build_args)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd.kill_on_drop(true);

    let result = tokio::time::timeout(BUILD_TIMEOUT, cmd.output()).await;
    let _ = std::fs::remove_dir_all(&ctx); // clean the context regardless
    let out = result
        .map_err(|_| AppError::Timeout(BUILD_TIMEOUT.as_secs()))?
        .map_err(AppError::Io)?;
    if !out.status.success() {
        let mut log = String::from_utf8_lossy(&out.stdout).into_owned();
        log.push_str(&String::from_utf8_lossy(&out.stderr));
        let tail: String = log
            .lines()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(AppError::Command(format!(
            "Building the agent image failed:\n{tail}"
        )));
    }
    Ok(())
}

// --- per-session claude-home (mounted, holds creds + transcript) -------------

fn agent_home_root(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
        .join("agent-home"))
}

/// `<app_data>/agent-home/<session>/<agent>` — mounted at the container's
/// `~/.claude` or `~/.codex`. Session ids are app-generated hex; validated upstream.
fn session_home(app: &AppHandle, session_id: &str, agent: &str) -> AppResult<PathBuf> {
    Ok(agent_home_root(app)?.join(session_id).join(agent))
}

/// Ensures the per-session agent-home exists and (re-)seeds the host's current
/// credentials for `agent` into it, so the container authenticates with the
/// user's live subscription and a refreshed token each run. Returns the home path
/// to mount. Claude reads `~/.claude/.credentials.json`; Codex `~/.codex/auth.json`.
pub(crate) fn seed_session_home(
    app: &AppHandle,
    session_id: &str,
    agent: &str,
) -> AppResult<PathBuf> {
    crate::sessions::validate_id(session_id)?; // no path traversal into the home root
    let home = session_home(app, session_id, agent)?;
    std::fs::create_dir_all(&home)?;
    // Re-copy every run so an expired in-home token is refreshed from the host's
    // current one. Best-effort: the container branch pre-checks `host_logged_in`
    // for a clearer message if the creds are absent.
    if let Some(src) = host_creds(agent) {
        if let (true, Some(name)) = (src.is_file(), src.file_name()) {
            let _ = std::fs::copy(&src, home.join(name));
        }
    }
    Ok(home)
}

/// Removes a session's claude-home (on discard / kept-record delete) and force-
/// removes any lingering container. Best-effort.
#[tauri::command]
pub async fn agent_sandbox_cleanup(app: AppHandle, session_id: String) -> AppResult<()> {
    // This deletes a directory by id, so reject any traversal before touching FS.
    crate::sessions::validate_id(&session_id)?;
    if let Ok(dir) = agent_home_root(&app).map(|r| r.join(&session_id)) {
        let _ = std::fs::remove_dir_all(dir);
    }
    if let Some((bin, _)) = detect_runtime().await {
        let name = container_name(&session_id);
        let _ = run_capture(&bin, &["rm", "-f", &name], DETECT_TIMEOUT).await;
    }
    Ok(())
}

// --- launch ------------------------------------------------------------------

pub(crate) fn container_name(session_id: &str) -> String {
    format!("gd-agent-{session_id}")
}

/// Converts a host path to the `-v` source form the engine expects. The Windows
/// form is RUNTIME-SPECIFIC (validated 2026-06-22): Docker Desktop wants the
/// MSYS-style `//c/a/b`, while Podman (a WSL machine) wants the WSL path
/// `/mnt/c/a/b` and rejects `//c/...` with "no such file or directory".
/// Elsewhere (Linux/macOS) both runtimes take the POSIX path as-is.
pub(crate) fn to_mount_source(path: &str, runtime: &str) -> String {
    #[cfg(windows)]
    {
        let bytes = path.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            let drive = (bytes[0] as char).to_ascii_lowercase();
            let rest = path[2..].replace('\\', "/");
            let rest = rest.trim_start_matches('/');
            return if runtime == "podman" {
                format!("/mnt/{drive}/{rest}")
            } else {
                format!("//{drive}/{rest}")
            };
        }
        path.replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        let _ = runtime;
        path.to_string()
    }
}

/// Builds the full `run …` argv that wraps the inner agent invocation in an
/// ephemeral, worktree-confined container. The agent runs as `node`, cwd
/// `/workspace` (the bind-mounted worktree), with the seeded claude-home mounted +
/// (when present) the user's global skills mounted read-only so a nudged skill
/// resolves; `--rm` tears it down, resource + capability limits harden it.
pub(crate) fn build_run_args(
    runtime: &str,
    agent: &str,
    worktree_path: &str,
    home_path: &Path,
    container_name: &str,
    // Host path to the global skills store to mount read-only (None = don't mount).
    skills_src: Option<&str>,
    inner: &[String],
) -> Vec<String> {
    let workspace_mount = format!("{}:/workspace", to_mount_source(worktree_path, runtime));
    // The agent-home mounts at the CLI's own dotdir so it finds its creds +
    // session transcript (Codex resumes via `--last` from its mounted ~/.codex).
    let home_target = agent_dotdir(agent);
    let home_mount = format!(
        "{}:{}",
        to_mount_source(&home_path.to_string_lossy(), runtime),
        home_target
    );
    let mut args: Vec<String> = vec![
        "run".into(),
        "--rm".into(),
        "-i".into(),
        "--name".into(),
        container_name.into(),
    ];
    // Copilot authenticates from a GitHub token instead of a mounted creds file. Pass
    // it through to the container BY NAME (no `=value`): the runtime client inherits
    // `COPILOT_GITHUB_TOKEN` from its own env (set in the `agent_session` container
    // branch), so the token never appears in this argv / `docker inspect`.
    if agent == "copilot" {
        args.push("-e".into());
        args.push("COPILOT_GITHUB_TOKEN".into());
    }
    // Rootless Podman on Linux maps the container's non-root `node` (uid 1000) to
    // a host *subuid*, so it can't even write the host-user-owned worktree, and
    // any files it does write aren't owned by the host user (its git can't touch
    // them). `keep-id` maps the host user in as `node` so writes land owned by the
    // host user. Validated 2026-06-22 (without it: EACCES; with it: files owned by
    // the host uid, host git works). NOT needed for Docker, nor the Podman-machine
    // VMs on Windows/macOS (NTFS/VirtioFS already present files as the host user) —
    // and `keep-id` assumes the host login uid is 1000 (= our image's `node`),
    // the overwhelmingly common Linux-desktop case.
    if cfg!(target_os = "linux") && runtime == "podman" {
        args.push("--userns=keep-id".into());
    }
    args.extend([
        "--user".into(),
        "node".into(),
        "-w".into(),
        "/workspace".into(),
        "-v".into(),
        workspace_mount,
        "-v".into(),
        home_mount,
    ]);
    // Mount the user's GLOBAL skills read-only so a skill nudged by name resolves
    // in-container like it does on the host (the worktree only carries PROJECT
    // skills). Target is per-agent (`skills_target`); for Claude it nests under the
    // `~/.claude` home mount, so it MUST be added after it. `:ro` — the agent reads
    // skills, never edits the user's store.
    if let Some(src) = skills_src {
        args.push("-v".into());
        args.push(format!(
            "{}:{}:ro",
            to_mount_source(src, runtime),
            skills_target(agent)
        ));
    }
    args.extend([
        // Hardening: drop Linux capabilities (a userland Node process needs
        // none), block privilege escalation, and cap resources.
        "--cap-drop".into(),
        "ALL".into(),
        "--security-opt".into(),
        "no-new-privileges".into(),
        "--memory".into(),
        "4g".into(),
        "--pids-limit".into(),
        "1024".into(),
        IMAGE.into(),
    ]);
    // Name the agent CLI as the in-container command. The image inherits the `node`
    // base entrypoint, which execs its args directly BUT prepends `node` to a leading
    // `-flag` — so a bare `-p …` / `exec …` (what the `*_session_args` builders emit,
    // since the host path supplies the binary separately) would run `node`, not the
    // CLI. The CLIs install on PATH under exactly these names
    // (`claude`/`codex`/`opencode`/`copilot`), so prepend `agent` here.
    args.push(agent.into());
    args.extend(inner.iter().cloned());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mount_source_posix_is_unchanged() {
        // On non-Windows this is identity for either runtime.
        assert_eq!(to_mount_source("/home/u/wt", "docker"), "/home/u/wt");
        assert_eq!(to_mount_source("/home/u/wt", "podman"), "/home/u/wt");
    }

    #[cfg(windows)]
    #[test]
    fn mount_source_windows_form_is_runtime_specific() {
        // Docker Desktop wants //c/..., Podman (WSL) wants /mnt/c/...
        assert_eq!(to_mount_source("C:\\Temp\\x", "docker"), "//c/Temp/x");
        assert_eq!(to_mount_source("C:\\Temp\\x", "podman"), "/mnt/c/Temp/x");
        assert_eq!(to_mount_source("D:\\a\\b\\c", "podman"), "/mnt/d/a/b/c");
    }

    #[test]
    fn build_run_args_mounts_workspace_and_home_then_inner() {
        let home = PathBuf::from(if cfg!(windows) {
            "C:\\data\\agent-home\\s1\\claude"
        } else {
            "/data/agent-home/s1/claude"
        });
        let inner = vec!["-p".to_string(), "--resume".to_string(), "s1".to_string()];
        let args = build_run_args(
            "docker",
            "claude",
            "/repos/wt",
            &home,
            "gd-agent-s1",
            None,
            &inner,
        );
        assert_eq!(args[0], "run");
        assert!(args.contains(&"--rm".to_string()));
        assert!(args.contains(&"node".to_string())); // runs as non-root
        assert!(args.iter().any(|a| a.ends_with(":/workspace")));
        assert!(args.iter().any(|a| a.ends_with(":/home/node/.claude")));
        // Codex mounts its home at ~/.codex instead.
        let codex = build_run_args("docker", "codex", "/repos/wt", &home, "n", None, &inner);
        assert!(codex.iter().any(|a| a.ends_with(":/home/node/.codex")));
        // opencode mounts its XDG data dir.
        let oc = build_run_args("docker", "opencode", "/repos/wt", &home, "n", None, &inner);
        assert!(oc
            .iter()
            .any(|a| a.ends_with(":/home/node/.local/share/opencode")));
        assert!(args.contains(&IMAGE.to_string()));
        // After IMAGE: the agent CLI command name, then its inner args (the node base
        // entrypoint would otherwise run `node` on a bare `-p …`).
        let img = args.iter().position(|a| a == IMAGE).unwrap();
        assert_eq!(args[img + 1], "claude");
        assert_eq!(&args[img + 2..], &inner[..]);
    }

    #[test]
    fn copilot_passes_token_env_by_name_only() {
        let home = PathBuf::from("/data/agent-home/s1/copilot");
        let inner = vec!["-p".to_string(), "hi".to_string()];
        let cp = build_run_args("docker", "copilot", "/repos/wt", &home, "n", None, &inner);
        // Token is passed through by NAME (no `=value`) so it never lands in argv.
        let e = cp.iter().position(|a| a == "-e").expect("has -e");
        assert_eq!(cp[e + 1], "COPILOT_GITHUB_TOKEN");
        assert!(!cp.iter().any(|a| a.contains("COPILOT_GITHUB_TOKEN=")));
        // Copilot's home mounts at ~/.copilot (for its session-store.db).
        assert!(cp.iter().any(|a| a.ends_with(":/home/node/.copilot")));
        // The CLI command name is prepended after IMAGE.
        let img = cp.iter().position(|a| a == IMAGE).unwrap();
        assert_eq!(cp[img + 1], "copilot");
        // Other agents get no token env passthrough.
        let claude = build_run_args("docker", "claude", "/repos/wt", &home, "n", None, &inner);
        assert!(!claude.iter().any(|a| a == "COPILOT_GITHUB_TOKEN"));
    }

    #[test]
    fn mounts_global_skills_read_only_at_agent_dir() {
        let home = PathBuf::from("/data/agent-home/s1/x");
        let inner = vec!["-p".to_string()];
        let src = if cfg!(windows) {
            "C:\\Users\\u\\.agents\\skills"
        } else {
            "/home/u/.agents/skills"
        };
        // Claude reads only ~/.claude/skills; the mount is read-only.
        let cl = build_run_args("docker", "claude", "/repos/wt", &home, "n", Some(src), &inner);
        assert!(cl
            .iter()
            .any(|a| a.ends_with(":/home/node/.claude/skills:ro")));
        // Every other agent reads the vendor-neutral ~/.agents/skills.
        let cx = build_run_args("docker", "codex", "/repos/wt", &home, "n", Some(src), &inner);
        assert!(cx
            .iter()
            .any(|a| a.ends_with(":/home/node/.agents/skills:ro")));
        // No source → no skills mount at all.
        let none = build_run_args("docker", "claude", "/repos/wt", &home, "n", None, &inner);
        assert!(!none.iter().any(|a| a.contains("/skills:ro")));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_podman_adds_keep_id_docker_does_not() {
        let home = PathBuf::from("/data/agent-home/s1/claude");
        let inner = vec!["-p".to_string()];
        let podman = build_run_args("podman", "claude", "/repos/wt", &home, "n", None, &inner);
        assert!(podman.iter().any(|a| a == "--userns=keep-id"));
        let docker = build_run_args("docker", "claude", "/repos/wt", &home, "n", None, &inner);
        assert!(!docker.iter().any(|a| a == "--userns=keep-id"));
    }

    #[test]
    fn container_name_is_stable_and_prefixed() {
        assert_eq!(container_name("abc123"), "gd-agent-abc123");
    }

    #[test]
    fn render_dockerfile_selects_node_and_providers() {
        let df = render_dockerfile("24", &["claude".into(), "codex".into()]).unwrap();
        assert!(df.contains("FROM node:24-slim"));
        assert!(df.contains("@anthropic-ai/claude-code"));
        assert!(df.contains("@openai/codex"));
        assert!(df.contains("ca-certificates")); // TLS roots, else the agents fail
        // A codex-only image omits the claude package + its dotdir.
        let codex_only = render_dockerfile("22", &["codex".into()]).unwrap();
        assert!(codex_only.contains("FROM node:22-slim"));
        assert!(codex_only.contains("@openai/codex"));
        assert!(!codex_only.contains("claude-code"));
        // opencode is container-capable: its npm package + deep XDG dotdir, and the
        // whole-home chown that makes that deep dir usable by the `node` user.
        let oc = render_dockerfile("24", &["opencode".into()]).unwrap();
        assert!(oc.contains("opencode-ai"));
        assert!(oc.contains("/home/node/.local/share/opencode"));
        assert!(oc.contains("chown -R node:node /home/node"));
        // Copilot is now container-capable too (npm package + its dotdir); it auths
        // from an env token rather than a mounted creds file.
        let cp = render_dockerfile("24", &["copilot".into()]).unwrap();
        assert!(cp.contains("@github/copilot"));
        assert!(cp.contains("/home/node/.copilot"));
        // Bad inputs rejected: non-numeric version, empty set, unknown agent.
        assert!(render_dockerfile("24; rm -rf /", &["claude".into()]).is_err());
        assert!(render_dockerfile("24", &[]).is_err());
        assert!(render_dockerfile("24", &["cursor".into()]).is_err());
    }

    #[test]
    fn config_signature_is_order_independent() {
        assert_eq!(
            config_signature("24", &["codex".into(), "claude".into()]),
            config_signature("24", &["claude".into(), "codex".into()])
        );
        assert_eq!(
            config_signature("24", &["claude".into(), "codex".into()]),
            "node24-claude-codex"
        );
    }
}
