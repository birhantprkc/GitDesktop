//! Managed MCP-server config generation for agent sessions.
//!
//! GitDesktop is not an MCP client — the CLIs are the hosts. This module only
//! turns the user's registered, session-opted-in servers into the config file a
//! CLI consumes, resolving any secret env/header values from the OS keychain at
//! launch time (so secrets never live in settings.json, argv, or the worktree).
//!
//! Tier 1 covers **Claude Code on the host**. The other CLIs (their config
//! shapes differ) and container delivery are later tiers; `build_claude_config`
//! is the only adapter wired today.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

/// One opted-in server, passed from the frontend (resolved from the settings
/// registry). Secret values are NOT here — `secret_keys` names the env/header
/// entries whose values live in the keychain under `mcp-server/<id>/<key>`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSpec {
    pub id: String,
    pub name: String,
    /// "stdio" | "http".
    pub transport: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<KeyValue>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    #[serde(default)]
    pub secret_keys: Vec<String>,
}

impl McpServerSpec {
    fn is_stdio(&self) -> bool {
        self.transport == "stdio"
    }
    /// env (stdio) or headers (http) for this server's transport.
    fn entries(&self) -> &[KeyValue] {
        if self.is_stdio() {
            &self.env
        } else {
            &self.headers
        }
    }
}

/// Resolve a server's env/header map, substituting secret values from the
/// keychain. Fails loudly if an entry is marked secret but has no stored value —
/// a silent empty token would just make the server fail opaquely at runtime.
fn resolve_entries(spec: &McpServerSpec) -> AppResult<Map<String, Value>> {
    let secret: std::collections::HashSet<&str> =
        spec.secret_keys.iter().map(String::as_str).collect();
    let mut out = Map::new();
    for kv in spec.entries() {
        let value = if secret.contains(kv.key.as_str()) {
            crate::secrets::read_mcp_secret(&spec.id, &kv.key)?.ok_or_else(|| {
                AppError::Command(format!(
                    "MCP server \"{}\": secret \"{}\" isn't set. Add it in Settings → MCP servers.",
                    spec.name, kv.key
                ))
            })?
        } else {
            kv.value.clone()
        };
        out.insert(kv.key.clone(), Value::String(value));
    }
    Ok(out)
}

/// Claude's `--tools` allowlist entries that expose every opted-in server's
/// tools: `mcp__<server>` admits all tools from that server. Loading a server via
/// `--mcp-config` is NOT enough — `--tools` is a strict allowlist, so without
/// these the server connects but its tools can never be called (caught live).
pub fn tool_allow_patterns(specs: &[McpServerSpec]) -> Vec<String> {
    specs.iter().map(|s| format!("mcp__{}", s.name)).collect()
}

/// Build Claude Code's `{ "mcpServers": { name: {…} } }` document for the given
/// opted-in servers. Each server is keyed by its (unique) name.
pub fn build_claude_config(specs: &[McpServerSpec]) -> AppResult<Value> {
    let mut servers = Map::new();
    for spec in specs {
        let entry = if spec.is_stdio() {
            json!({
                "command": spec.command,
                "args": spec.args,
                "env": resolve_entries(spec)?,
            })
        } else {
            json!({
                "type": "http",
                "url": spec.url,
                "headers": resolve_entries(spec)?,
            })
        };
        servers.insert(spec.name.clone(), entry);
    }
    Ok(json!({ "mcpServers": servers }))
}

/// Server-name charset (mirrors the frontend `MCP_NAME_RE`): a letter/digit first,
/// then letters/digits/`-`/`_`. Safe as a bare TOML key and a JSON map key.
fn is_valid_server_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Pre-flight each opted-in server before turn 1 spawns. Catches the
/// deterministic failures — bad name, missing command/url, a secret that was never
/// entered — with an actionable message so the user fixes it instead of seeing
/// the agent fail opaquely. (Resolving the stdio binary on PATH is intentionally
/// left to the CLI itself: a cross-platform PATH/PATHEXT probe is fragile enough
/// that a false "not found" would block valid setups.)
pub fn validate_specs(specs: &[McpServerSpec]) -> AppResult<()> {
    for spec in specs {
        // The name is a config key (a bare TOML table key for Codex, a JSON map
        // key for Claude). The frontend constrains it, but validate it server-side
        // too so a name from any future caller can't break / inject the config.
        if !is_valid_server_name(&spec.name) {
            return Err(AppError::Command(format!(
                "MCP server name \"{}\" is invalid — use letters, digits, - and _ (starting with a letter or digit).",
                spec.name
            )));
        }
        if spec.is_stdio() {
            if spec.command.trim().is_empty() {
                return Err(AppError::Command(format!(
                    "MCP server \"{}\" has no command to run.",
                    spec.name
                )));
            }
        } else {
            let url = spec.url.trim();
            if !(url.starts_with("http://") || url.starts_with("https://")) {
                return Err(AppError::Command(format!(
                    "MCP server \"{}\" needs a valid http(s) URL.",
                    spec.name
                )));
            }
        }
        // Force keychain resolution now so a missing secret is reported here, by
        // name, rather than as a runtime failure inside the CLI.
        resolve_entries(spec)?;
    }
    Ok(())
}

/// `<app_data>/mcp` — where per-session host config files are written. Kept out
/// of the repo/worktree entirely (the generated file may contain resolved
/// secrets, so it must never be a candidate for commit).
fn config_root(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
        .join("mcp"))
}

/// Validate + generate the Claude config for a HOST session and write it to a
/// stable per-session path (`<app_data>/mcp/<session_id>.json`), returning that
/// path for `--mcp-config`. Overwritten each turn so an edited registry takes
/// effect on the next turn. Returns `Ok(None)` when there are no servers.
pub fn write_host_config(
    app: &tauri::AppHandle,
    session_id: &str,
    specs: &[McpServerSpec],
) -> AppResult<Option<PathBuf>> {
    if specs.is_empty() {
        return Ok(None);
    }
    crate::sessions::validate_id(session_id)?;
    validate_specs(specs)?;
    let config = build_claude_config(specs)?;
    let dir = config_root(app)?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{session_id}.json"));
    let body = serde_json::to_string_pretty(&config)
        .map_err(|e| AppError::Command(format!("serialize mcp config: {e}")))?;
    std::fs::write(&path, body)?;
    Ok(Some(path))
}

/// Remove a session's generated host config (best-effort), called on cleanup so
/// resolved-secret files don't linger after a session is discarded.
pub fn cleanup_host_config(app: &tauri::AppHandle, session_id: &str) {
    if crate::sessions::validate_id(session_id).is_err() {
        return;
    }
    if let Ok(dir) = config_root(app) {
        let _ = std::fs::remove_file(dir.join(format!("{session_id}.json")));
    }
}

// --- Codex (container only) --------------------------------------------------
//
// Codex reads MCP servers from its `~/.codex/config.toml`, NOT a `--mcp-config`
// flag. A container session's `~/.codex` is a per-session mounted home seeded
// with only the user's `auth.json`, so writing our `config.toml` there makes the
// opted-in servers the ONLY MCP source (strict) and keeps secrets in the file,
// never in argv. Host Codex is unsupported on purpose: `codex exec` cancels every
// MCP tool call (stdin EOF → "declined", upstream); the container already passes
// `--dangerously-bypass-approvals-and-sandbox`, so its tool calls run.

/// A TOML basic-string literal for an arbitrary value — escapes quotes, backslashes
/// and control chars, so a secret with special characters can't break the file.
fn toml_basic_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Control chars incl. DEL (U+007F) must be escaped or the TOML parser
            // rejects the whole file — a secret with a stray control byte otherwise
            // fails the session opaquely.
            c if (c as u32) < 0x20 || c == '\u{7f}' => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A TOML key — bare when it's the safe charset, else a quoted literal.
fn toml_key(s: &str) -> String {
    if !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        s.to_string()
    } else {
        toml_basic_string(s)
    }
}

/// Build Codex's `config.toml` body for the opted-in servers (written into the
/// session's mounted `~/.codex` home). **stdio only** — Codex's remote-MCP config
/// supports just a bearer token, not the arbitrary headers our http servers carry,
/// so the composer offers Codex local servers only; a remote one here is an error.
/// Secrets are resolved into each `[mcp_servers.<name>.env]` table.
pub fn build_codex_config(specs: &[McpServerSpec]) -> AppResult<String> {
    let mut out = String::new();
    for spec in specs {
        if !spec.is_stdio() {
            return Err(AppError::Command(format!(
                "Codex sessions support local (stdio) MCP servers only right now; \
                 \"{}\" is a remote server.",
                spec.name
            )));
        }
        // The server name is validated (letters/digits/`-`/`_`), so it's a safe
        // bare TOML key.
        out.push_str(&format!("[mcp_servers.{}]\n", spec.name));
        out.push_str(&format!("command = {}\n", toml_basic_string(&spec.command)));
        let args: Vec<String> = spec.args.iter().map(|a| toml_basic_string(a)).collect();
        out.push_str(&format!("args = [{}]\n", args.join(", ")));
        let env = resolve_entries(spec)?;
        if !env.is_empty() {
            out.push_str(&format!("\n[mcp_servers.{}.env]\n", spec.name));
            for (key, value) in &env {
                out.push_str(&format!(
                    "{} = {}\n",
                    toml_key(key),
                    toml_basic_string(value.as_str().unwrap_or(""))
                ));
            }
        }
        out.push('\n');
    }
    Ok(out)
}

// --- discovery (import, not inherit) -----------------------------------------
//
// Reads the MCP servers the user has ALREADY configured for Claude — the open
// repo's `.mcp.json` and the global `~/.claude.json` — so the Settings panel can
// offer them as a reviewed import into the managed registry. This is the only
// place GitDesktop reads those files; sessions never inherit them (that's what
// `--strict-mcp-config` enforces). Read-only: the source files are never written.

/// One server found in an existing config, with where it came from. `config` is
/// the raw server object (Claude `.mcp.json` shape) for the frontend to convert.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredServer {
    /// "repo" (the open repo's `.mcp.json`) or "global" (`~/.claude.json`).
    origin: String,
    name: String,
    config: Value,
}

/// `mcpServers` map from a config file, pushing each entry. Best-effort: a
/// missing / oversized / malformed file is silently skipped (it just yields no
/// imports). The size guard keeps a large `~/.claude.json` (it also holds chat
/// history) from being slurped whole.
fn collect_discovered(path: &Path, origin: &str, out: &mut Vec<DiscoveredServer>) {
    const MAX_BYTES: u64 = 16 * 1024 * 1024;
    match std::fs::metadata(path) {
        Ok(m) if m.len() <= MAX_BYTES => {}
        _ => return,
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(json) = serde_json::from_str::<Value>(&text) else {
        return;
    };
    if let Some(servers) = json.get("mcpServers").and_then(|v| v.as_object()) {
        for (name, config) in servers {
            out.push(DiscoveredServer {
                origin: origin.into(),
                name: name.clone(),
                config: config.clone(),
            });
        }
    }
}

/// Discover MCP servers already configured for Claude, for the Settings import
/// flow: the open repo's `.mcp.json` (when a repo is open) and the global
/// `~/.claude.json`. Read-only; returns an empty list when neither exists.
#[tauri::command]
pub async fn discover_mcp_servers(
    app: tauri::AppHandle,
    repo_path: Option<String>,
) -> AppResult<Vec<DiscoveredServer>> {
    use tauri::Manager;
    let mut out = Vec::new();
    if let Some(rp) = repo_path.as_deref().filter(|s| !s.is_empty()) {
        collect_discovered(&Path::new(rp).join(".mcp.json"), "repo", &mut out);
    }
    if let Ok(home) = app.path().home_dir() {
        collect_discovered(&home.join(".claude.json"), "global", &mut out);
    }
    Ok(out)
}
