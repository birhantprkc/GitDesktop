//! Tier-3: GitDesktop **as** an MCP server.
//!
//! Exposes GitDesktop's read-only git/GitHub knowledge as MCP tools that any
//! external agent (Claude Desktop, Cursor, Claude Code, …) can call. This is the
//! opposite direction from [`crate::mcp`], which is the CLIENT side (building MCP
//! config for the CLI agents we host).
//!
//! P1: the curated read-only tool surface — P1a local git + P1b GitHub. Metadata
//! tools reuse an existing command core directly (none need a Tauri `State`); the
//! raw-diff tools (commit_diff/working_diff/diff_refs) issue `git` directly so they
//! get consistent caps + intuitive semantics (the structured UI diff commands have
//! quirks an agent shouldn't inherit). Compiled only under the `mcp-server` feature
//! and driven by the `gitdesktop-mcp` binary. Design + the full curated surface
//! live in docs/mcp-server-tier3.md. (The in-app config helper = P1c.)

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content, ServerCapabilities, ServerInfo};
use rmcp::transport::stdio;
use rmcp::{
    schemars, tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt,
};

use crate::error::AppError;
use crate::git::runner::{run_git, run_git_raw, DEFAULT_TIMEOUT};
use crate::git::status::status_core;

/// Cap raw diff output so a runaway diff can't blow the client's context.
const DIFF_MAX_BYTES: usize = 100_000;
/// Cap `read_file` output for the same reason.
const READ_FILE_MAX_BYTES: usize = 200_000;
/// Cap GitHub text output (PR diffs, CI logs) for the same reason.
const GH_TEXT_MAX_BYTES: usize = 100_000;

/// The MCP server handler, bound to a single repository — the `--repo` the server
/// was launched against. Every tool operates on `repo` (no ambient "active repo"
/// state exists in the backend; the binding is explicit, which keeps tools
/// stateless and the server multi-repo-safe across separate launches).
#[derive(Clone)]
pub struct GitDesktopMcp {
    repo: String,
    // Read by the `#[tool_handler]`-generated `list_tools`/`call_tool`; the
    // dead-code lint misses that (it only sees the derived `Clone` touch it).
    #[allow(dead_code)]
    tool_router: ToolRouter<GitDesktopMcp>,
}

// ---- Local-git tool parameters (P1a) --------------------------------------

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct LogArgs {
    /// Max commits to return (default 50).
    #[serde(default)]
    limit: Option<u32>,
    /// Commits to skip from HEAD, for paging (default 0).
    #[serde(default)]
    skip: Option<u32>,
    /// Optional filter; matches commit message and author.
    #[serde(default)]
    search: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct FileHistoryArgs {
    /// Repo-relative path of the file.
    path: String,
    /// Max commits to return (default 50).
    #[serde(default)]
    limit: Option<u32>,
    /// Commits to skip, for paging (default 0).
    #[serde(default)]
    skip: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct PathArg {
    /// Repo-relative path of the file.
    path: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct ShaArg {
    /// Commit SHA, or any rev (branch, tag, HEAD).
    sha: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CommitDiffArgs {
    /// Commit SHA, or any rev (branch, tag, HEAD).
    sha: String,
    /// Limit to a single file (repo-relative). Omit for the whole commit.
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct WorkingDiffArgs {
    /// Limit to a single file (repo-relative). Omit for all changes.
    #[serde(default)]
    path: Option<String>,
    /// Show only staged changes (vs HEAD). Default false = all uncommitted
    /// changes (staged + unstaged) vs HEAD.
    #[serde(default)]
    staged: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct DiffRefsArgs {
    /// The "from" ref (base) — branch, tag, or SHA.
    base: String,
    /// The "to" ref (head) — branch, tag, or SHA.
    head: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct ReadFileArgs {
    /// Repo-relative path of the file.
    path: String,
    /// Optional rev to read the file at (branch/tag/SHA). Omit to read the
    /// current working-tree contents.
    #[serde(default, rename = "ref")]
    at_ref: Option<String>,
}

// ---- GitHub tool parameters (P1b) -----------------------------------------

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct StateArg {
    /// "open" (default) or "closed".
    #[serde(default)]
    state: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct NumberArg {
    /// The pull request or issue number.
    number: u64,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct RunIdArg {
    /// The GitHub Actions workflow run id.
    run_id: u64,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct RunListArgs {
    /// Max runs to return (default 20).
    #[serde(default)]
    limit: Option<u32>,
    /// Limit to a branch name.
    #[serde(default)]
    branch: Option<String>,
}

#[tool_router]
impl GitDesktopMcp {
    // ---- Local git (P1a) --------------------------------------------------

    #[tool(
        description = "Working-tree status: current branch, upstream, ahead/behind counts, and \
                       the staged/unstaged/untracked file changes. Returns JSON."
    )]
    async fn repo_status(&self) -> Result<CallToolResult, McpError> {
        let status = status_core(&self.repo).await.map_err(app_err)?;
        json_result(&status)
    }

    #[tool(
        description = "List recent commits (sha, author, date, subject). Supports paging via \
                       limit/skip and an optional message/author search filter."
    )]
    async fn log(&self, Parameters(args): Parameters<LogArgs>) -> Result<CallToolResult, McpError> {
        let commits = crate::git::history::git_log(
            self.repo.clone(),
            args.limit.unwrap_or(50),
            args.skip.unwrap_or(0),
            args.search,
        )
        .await
        .map_err(app_err)?;
        json_result(&commits)
    }

    #[tool(description = "List the commits that touched a single file (newest first).")]
    async fn file_history(
        &self,
        Parameters(args): Parameters<FileHistoryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let commits = crate::git::history::git_file_log(
            self.repo.clone(),
            args.path,
            args.limit.unwrap_or(50),
            args.skip.unwrap_or(0),
        )
        .await
        .map_err(app_err)?;
        json_result(&commits)
    }

    #[tool(
        description = "List local branches with their upstream and current/archived flags. \
                       Returns JSON. (For ahead/behind counts, see repo_status.)"
    )]
    async fn list_branches(&self) -> Result<CallToolResult, McpError> {
        let branches = crate::git::branches::git_branches(self.repo.clone())
            .await
            .map_err(app_err)?;
        json_result(&branches)
    }

    #[tool(description = "Per-line authorship (git blame) for a file: each line's commit/author.")]
    async fn blame(
        &self,
        Parameters(args): Parameters<PathArg>,
    ) -> Result<CallToolResult, McpError> {
        let lines = crate::git::history::git_blame(self.repo.clone(), args.path)
            .await
            .map_err(app_err)?;
        json_result(&lines)
    }

    #[tool(
        description = "Show a commit (accepts any rev: SHA, branch, tag, HEAD): its message/author \
                       metadata plus the list of changed files with add/delete counts. Returns JSON."
    )]
    async fn show_commit(
        &self,
        Parameters(args): Parameters<ShaArg>,
    ) -> Result<CallToolResult, McpError> {
        // Resolve the rev to a SHA first, so branch/tag/HEAD work (the underlying
        // commands validate a hex hash).
        let sha = resolve_commit(&self.repo, &args.sha).await?;
        let details = crate::git::history::git_commit_details(self.repo.clone(), sha.clone())
            .await
            .map_err(app_err)?;
        let files = crate::git::history::git_commit_files(self.repo.clone(), sha)
            .await
            .map_err(app_err)?;
        let body = serde_json::json!({ "details": to_value(&details)?, "files": to_value(&files)? });
        json_result(&body)
    }

    #[tool(
        description = "Raw unified diff of a commit (accepts any rev: SHA, branch, tag, HEAD) — the \
                       whole commit, or a single file when `path` is given. Large diffs are truncated."
    )]
    async fn commit_diff(
        &self,
        Parameters(args): Parameters<CommitDiffArgs>,
    ) -> Result<CallToolResult, McpError> {
        ensure_not_flag(&args.sha, "sha")?;
        let mut a: Vec<&str> = vec!["show", "--no-color", args.sha.as_str()];
        if let Some(path) = args.path.as_deref() {
            a.push("--");
            a.push(path);
        }
        diff_text(&self.repo, &a).await
    }

    #[tool(
        description = "Raw unified diff of uncommitted changes. Default shows ALL changes \
                       (staged + unstaged) vs HEAD; set staged=true for staged-only. Optionally \
                       scope to one file. For a NEW/untracked file's content, use read_file. \
                       Large diffs are truncated."
    )]
    async fn working_diff(
        &self,
        Parameters(args): Parameters<WorkingDiffArgs>,
    ) -> Result<CallToolResult, McpError> {
        let mut a: Vec<&str> = vec!["diff", "--no-color"];
        // `git diff HEAD` = staged + unstaged vs HEAD; `git diff --cached` = staged
        // vs HEAD. Scoping with `-- <path>` keeps the same base (unlike the per-file
        // UI command, which only diffs against the index).
        if args.staged.unwrap_or(false) {
            a.push("--cached");
        } else {
            a.push("HEAD");
        }
        if let Some(path) = args.path.as_deref() {
            a.push("--");
            a.push(path);
        }
        diff_text(&self.repo, &a).await
    }

    #[tool(
        description = "Raw unified diff between two refs (branches, tags, or SHAs) — the full \
                       difference between base and head (the two endpoints, not an ancestry range), \
                       so it never silently empties on diverged branches. Large diffs are truncated."
    )]
    async fn diff_refs(
        &self,
        Parameters(args): Parameters<DiffRefsArgs>,
    ) -> Result<CallToolResult, McpError> {
        ensure_not_flag(&args.base, "base")?;
        ensure_not_flag(&args.head, "head")?;
        diff_text(
            &self.repo,
            &["diff", "--no-color", &args.base, &args.head, "--"],
        )
        .await
    }

    #[tool(
        description = "Read a file's contents — the current working-tree version, or at a given \
                       rev when `ref` is set. Hard-scoped to the bound repository; binary files are \
                       refused. Large files are truncated."
    )]
    async fn read_file(
        &self,
        Parameters(args): Parameters<ReadFileArgs>,
    ) -> Result<CallToolResult, McpError> {
        let text = read_file_core(&self.repo, &args.path, args.at_ref.as_deref()).await?;
        Ok(CallToolResult::success(vec![Content::text(text)]))
    }

    #[tool(description = "List tags, newest first. Returns JSON.")]
    async fn list_tags(&self) -> Result<CallToolResult, McpError> {
        let tags = crate::git::ops::git_list_tags(self.repo.clone())
            .await
            .map_err(app_err)?;
        json_result(&tags)
    }

    #[tool(description = "List the repository's remotes with their URLs (credentials redacted). Returns JSON.")]
    async fn remotes(&self) -> Result<CallToolResult, McpError> {
        let names = crate::git::remote::git_remotes(self.repo.clone())
            .await
            .map_err(app_err)?;
        let mut out = Vec::with_capacity(names.len());
        for name in names {
            let url = crate::git::remote::git_remote_url(self.repo.clone(), name.clone())
                .await
                .map(|u| redact_url_credentials(&u))
                .unwrap_or_default();
            out.push(serde_json::json!({ "name": name, "url": url }));
        }
        json_result(&out)
    }

    // ---- GitHub (P1b) — all require an authenticated `gh` and hit the network -

    #[tool(
        description = "List pull requests. `state` is \"open\" (default) or \"closed\". Returns up \
                       to ~30 (the GitHub CLI default); narrow by state if the repo has more. \
                       Requires an authenticated GitHub CLI. Returns JSON."
    )]
    async fn list_pull_requests(
        &self,
        Parameters(args): Parameters<StateArg>,
    ) -> Result<CallToolResult, McpError> {
        let prs = crate::github::pr::gh_pr_list(
            self.repo.clone(),
            args.state.unwrap_or_else(|| "open".to_string()),
        )
        .await
        .map_err(app_err)?;
        json_result(&prs)
    }

    #[tool(
        description = "Get a pull request's full details (title, body, state, reviews, files) by \
                       number. Returns JSON."
    )]
    async fn get_pull_request(
        &self,
        Parameters(args): Parameters<NumberArg>,
    ) -> Result<CallToolResult, McpError> {
        let pr = crate::github::pr::gh_pr_view(self.repo.clone(), args.number)
            .await
            .map_err(app_err)?;
        json_result(&pr)
    }

    #[tool(description = "Get the unified diff of a pull request by number. Large diffs are truncated.")]
    async fn pull_request_diff(
        &self,
        Parameters(args): Parameters<NumberArg>,
    ) -> Result<CallToolResult, McpError> {
        let diff = crate::github::pr::gh_pr_diff(self.repo.clone(), args.number)
            .await
            .map_err(app_err)?;
        Ok(CallToolResult::success(vec![Content::text(cap_head(
            diff,
            GH_TEXT_MAX_BYTES,
        ))]))
    }

    #[tool(
        description = "List issues. `state` is \"open\" (default) or \"closed\". Returns up to ~30 \
                       (the GitHub CLI default); narrow by state if the repo has more. Requires an \
                       authenticated GitHub CLI. Returns JSON."
    )]
    async fn list_issues(
        &self,
        Parameters(args): Parameters<StateArg>,
    ) -> Result<CallToolResult, McpError> {
        let issues = crate::github::issue::gh_issue_list(
            self.repo.clone(),
            args.state.unwrap_or_else(|| "open".to_string()),
        )
        .await
        .map_err(app_err)?;
        json_result(&issues)
    }

    #[tool(
        description = "Get an issue's full details (title, body, comments, labels, assignees) by \
                       number. Returns JSON."
    )]
    async fn get_issue(
        &self,
        Parameters(args): Parameters<NumberArg>,
    ) -> Result<CallToolResult, McpError> {
        let issue = crate::github::issue::gh_issue_view(self.repo.clone(), args.number)
            .await
            .map_err(app_err)?;
        json_result(&issue)
    }

    #[tool(
        description = "List recent GitHub Actions workflow runs, optionally filtered to a branch. \
                       Returns JSON."
    )]
    async fn list_workflow_runs(
        &self,
        Parameters(args): Parameters<RunListArgs>,
    ) -> Result<CallToolResult, McpError> {
        let runs =
            crate::github::actions::gh_run_list(self.repo.clone(), args.limit.unwrap_or(20), args.branch)
                .await
                .map_err(app_err)?;
        json_result(&runs)
    }

    #[tool(description = "Get a workflow run's details (status, conclusion, jobs) by run id. Returns JSON.")]
    async fn get_workflow_run(
        &self,
        Parameters(args): Parameters<RunIdArg>,
    ) -> Result<CallToolResult, McpError> {
        let run = crate::github::actions::gh_run_view(self.repo.clone(), args.run_id)
            .await
            .map_err(app_err)?;
        json_result(&run)
    }

    #[tool(
        description = "Get the logs of the FAILED steps of a workflow run by run id — the most \
                       useful view for diagnosing a CI failure. Large logs are truncated to the tail."
    )]
    async fn workflow_failed_logs(
        &self,
        Parameters(args): Parameters<RunIdArg>,
    ) -> Result<CallToolResult, McpError> {
        let logs = crate::github::actions::gh_run_failed_logs(self.repo.clone(), args.run_id)
            .await
            .map_err(app_err)?;
        Ok(CallToolResult::success(vec![Content::text(cap_tail(
            logs,
            GH_TEXT_MAX_BYTES,
        ))]))
    }
}

impl GitDesktopMcp {
    pub fn new(repo: String) -> Self {
        Self {
            repo,
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_handler]
impl ServerHandler for GitDesktopMcp {
    fn get_info(&self) -> ServerInfo {
        // ServerInfo (InitializeResult) is #[non_exhaustive] — build from default,
        // then set the fields we care about.
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.instructions = Some(
            "GitDesktop as an MCP server (read-only). Tools act on the repository this server \
             was launched against (--repo). GitHub tools require an authenticated `gh` CLI."
                .into(),
        );
        info
    }
}

/// Maps a backend [`AppError`] to an MCP tool error.
fn app_err(e: AppError) -> McpError {
    McpError::internal_error(e.to_string(), None)
}

/// Rejects a value git would parse as an option (leading '-'), preventing a
/// user-supplied rev from being smuggled in as a flag.
fn ensure_not_flag(value: &str, what: &str) -> Result<(), McpError> {
    if value.starts_with('-') {
        return Err(McpError::invalid_params(
            format!("{what} must not start with '-'"),
            None,
        ));
    }
    Ok(())
}

/// Runs a `git` command that emits a unified diff and returns it as a capped text
/// MCP result. `git diff`/`git show` exit 0 even with changes (no `--exit-code`),
/// so `run_git`'s non-zero-is-error contract is fine here.
async fn diff_text(repo: &str, args: &[&str]) -> Result<CallToolResult, McpError> {
    let out = run_git(Some(repo), args, DEFAULT_TIMEOUT)
        .await
        .map_err(app_err)?;
    Ok(CallToolResult::success(vec![Content::text(cap_head(
        out.stdout_lossy(),
        DIFF_MAX_BYTES,
    ))]))
}

/// Resolves a rev (SHA, branch, tag, HEAD, …) to a full commit SHA, so the commit
/// tools accept any rev — not just a hex hash (their underlying commands validate
/// a hex string).
async fn resolve_commit(repo: &str, rev: &str) -> Result<String, McpError> {
    ensure_not_flag(rev, "rev")?;
    let out = run_git_raw(
        Some(repo),
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{rev}^{{commit}}"),
        ],
        DEFAULT_TIMEOUT,
    )
    .await
    .map_err(app_err)?;
    let sha = out.stdout_lossy().trim().to_string();
    if sha.is_empty() {
        return Err(McpError::invalid_params(format!("no such commit: {rev}"), None));
    }
    Ok(sha)
}

/// Redacts an in-URL credential (the `user:pass@` / `token@` userinfo) from an
/// http(s) remote URL, so `remotes` can't hand a secret to the connected agent.
fn redact_url_credentials(url: &str) -> String {
    for scheme in ["https://", "http://"] {
        if let Some(rest) = url.strip_prefix(scheme) {
            let authority_end = rest.find('/').unwrap_or(rest.len());
            if let Some(at) = rest[..authority_end].find('@') {
                return format!("{scheme}***@{}", &rest[at + 1..]);
            }
            return url.to_string();
        }
    }
    url.to_string()
}

/// Serializes a value to a `serde_json::Value`, mapping failures to an MCP error.
fn to_value<T: serde::Serialize>(value: &T) -> Result<serde_json::Value, McpError> {
    serde_json::to_value(value).map_err(|e| McpError::internal_error(e.to_string(), None))
}

/// Serializes a value to pretty JSON and wraps it as an MCP tool result.
fn json_result<T: serde::Serialize>(value: &T) -> Result<CallToolResult, McpError> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;
    Ok(CallToolResult::success(vec![Content::text(json)]))
}

/// Truncates a string to at most `max` bytes, keeping the **head** (char-boundary
/// safe) and appending a marker. For diffs/files, where the start matters most.
fn cap_head(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n\n…[truncated]", &s[..end])
}

/// Truncates a string to at most `max` bytes, keeping the **tail** (char-boundary
/// safe) and prepending a marker. For CI logs, where the failure is near the end.
fn cap_tail(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    format!("…[truncated]\n\n{}", &s[start..])
}

/// Reads a repo file's contents — working tree or at a rev — hard-scoped to the
/// repository root so a tool call can't escape it via `..` or an absolute path.
/// Binary content is refused (mirroring the working-tree branch's UTF-8 rejection).
async fn read_file_core(
    repo: &str,
    rel_path: &str,
    at_ref: Option<&str>,
) -> Result<String, McpError> {
    if rel_path.starts_with('/') || rel_path.starts_with('\\') {
        return Err(McpError::invalid_params(
            "path must be relative to the repository root",
            None,
        ));
    }
    if rel_path
        .split(|c| c == '/' || c == '\\')
        .any(|seg| seg == "..")
    {
        return Err(McpError::invalid_params("path must not contain '..'", None));
    }

    let raw = if let Some(r) = at_ref {
        if r.starts_with('-') {
            return Err(McpError::invalid_params("invalid ref", None));
        }
        // `git show <rev>:<path>` resolves the path within the repo tree.
        let spec = format!("{r}:{rel_path}");
        let out = run_git(Some(repo), &["show", &spec], DEFAULT_TIMEOUT)
            .await
            .map_err(app_err)?;
        // `git show` dumps a raw blob; reject binary (the working-tree branch's
        // read_to_string rejects non-UTF-8, so match that contract).
        if out.stdout.contains(&0u8) {
            return Err(McpError::invalid_params(
                "file appears to be binary",
                None,
            ));
        }
        out.stdout_lossy()
    } else {
        // Working-tree read, canonicalized and confined to the repo root.
        let root = tokio::fs::canonicalize(repo)
            .await
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        let target = tokio::fs::canonicalize(root.join(rel_path))
            .await
            .map_err(|_| McpError::invalid_params("file not found in repository", None))?;
        if !target.starts_with(&root) {
            return Err(McpError::invalid_params(
                "path escapes the repository root",
                None,
            ));
        }
        tokio::fs::read_to_string(&target)
            .await
            .map_err(|e| McpError::internal_error(e.to_string(), None))?
    };

    Ok(cap_head(raw, READ_FILE_MAX_BYTES))
}

/// Entry point for the `gitdesktop-mcp` binary. Parses `--repo <path>` (falling
/// back to the current working directory), then runs the stdio MCP server until
/// the client disconnects.
pub fn run_mcp_server() {
    let repo = parse_repo_arg();
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("gitdesktop-mcp: failed to start tokio runtime: {e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = rt.block_on(serve(repo)) {
        eprintln!("gitdesktop-mcp: {e}");
        std::process::exit(1);
    }
}

async fn serve(repo: String) -> Result<(), Box<dyn std::error::Error>> {
    let service = GitDesktopMcp::new(repo).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

/// Reads `--repo <path>` (or `--repo=<path>`) from argv; falls back to the current
/// working directory, matching how reference MCP git servers are configured.
fn parse_repo_arg() -> String {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--repo" {
            if let Some(path) = args.next() {
                return path;
            }
        } else if let Some(path) = arg.strip_prefix("--repo=") {
            return path.to_string();
        }
    }
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_string())
}
