//! The `gitdesktop-mcp` binary: GitDesktop as a stdio MCP server (Tier 3).
//!
//! Built only with `--features mcp-server`. Deliberately has NO
//! `windows_subsystem = "windows"` attribute — unlike the GUI app, this is a
//! console/stdio program and needs its stdin/stdout. See docs/mcp-server-tier3.md.

fn main() {
    gitdesktop_lib::run_mcp_server();
}
