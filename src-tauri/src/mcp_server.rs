//! Tier-3: GitDesktop **as** an MCP server.
//!
//! Exposes GitDesktop's read-only git/GitHub knowledge as MCP tools that any
//! external agent (Claude Desktop, Cursor, Claude Code, …) can call. This is the
//! opposite direction from [`crate::mcp`], which is the CLIENT side (building MCP
//! config for the CLI agents we host).
//!
//! P0 spike: a single `repo_status` tool over stdio, proving the bin → lib-core →
//! rmcp wiring end to end. Compiled only under the `mcp-server` feature and driven
//! by the `gitdesktop-mcp` binary. Full design + the curated tool surface live in
//! docs/mcp-server-tier3.md.

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{CallToolResult, Content, ServerCapabilities, ServerInfo};
use rmcp::transport::stdio;
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt};

use crate::git::status::status_core;

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

#[tool_router]
impl GitDesktopMcp {
    #[tool(
        description = "Get the working-tree status of the repository: current branch, \
                       upstream, ahead/behind counts, and the staged/unstaged/untracked \
                       file changes. Returns JSON."
    )]
    async fn repo_status(&self) -> Result<CallToolResult, McpError> {
        let status = status_core(&self.repo)
            .await
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        let json = serde_json::to_string_pretty(&status)
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        Ok(CallToolResult::success(vec![Content::text(json)]))
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
            "GitDesktop as an MCP server (read-only). Tools act on the repository this \
             server was launched against (--repo)."
                .into(),
        );
        info
    }
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
