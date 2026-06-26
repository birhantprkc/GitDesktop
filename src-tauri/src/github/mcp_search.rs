//! GitHub as a second MCP-discovery source for the Browse dialog.
//!
//! Searches GitHub for MCP-server repositories (topic-filtered, star-ranked) and
//! pulls each repo's `server.json` and `package.json` in the SAME GraphQL call,
//! so the frontend can derive an addable server without an N+1 of per-repo
//! requests: a `server.json` is the registry manifest shape (reused verbatim);
//! a `package.json` that depends on the MCP SDK becomes `npx -y <name>`; anything
//! else lands as a manual-setup stub. Rougher than the curated registry — read-only.

use serde::Serialize;

use crate::error::AppResult;
use crate::github::runner::{run_gh_raw, GH_NETWORK_TIMEOUT};

/// One repository hit, with its manifest files inlined (null when absent). The
/// frontend turns this into an addable server (see `mcp-registry.ts`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubMcpHit {
    pub name_with_owner: String,
    pub description: Option<String>,
    pub url: String,
    /// Raw `server.json` text (the registry manifest), when the repo has one.
    pub server_json: Option<String>,
    /// Raw `package.json` text, for the npm-package fallback.
    pub package_json: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubMcpSearchPage {
    pub repos: Vec<GithubMcpHit>,
    /// GraphQL `endCursor` when there's another page, else null.
    pub next_cursor: Option<String>,
}

/// Search + manifest fetch in one query. `object(expression:"HEAD:<file>")`
/// returns the blob (or null when the file is absent), so a missing manifest is
/// not an error — it just yields `None`.
const SEARCH_QUERY: &str = r#"query($q: String!, $after: String) {
  search(query: $q, type: REPOSITORY, first: 30, after: $after) {
    pageInfo { endCursor hasNextPage }
    nodes {
      ... on Repository {
        nameWithOwner
        description
        url
        sj: object(expression: "HEAD:server.json") { ... on Blob { text } }
        pj: object(expression: "HEAD:package.json") { ... on Blob { text } }
      }
    }
  }
}"#;

/// Search GitHub for MCP-server repositories. `query` is the user's free text
/// (may be empty to browse the popular ones); `cursor` pages through results.
#[tauri::command]
pub async fn gh_github_mcp_search(
    query: String,
    cursor: Option<String>,
) -> AppResult<GithubMcpSearchPage> {
    // `topic:mcp-server` is the server convention; the user's text narrows it,
    // server-side star sort surfaces the popular ones, `fork:false` trims clones.
    let q = format!("topic:mcp-server {} sort:stars-desc fork:false", query.trim());

    let query_arg = format!("query={SEARCH_QUERY}");
    let q_arg = format!("q={q}");
    let after_arg = cursor
        .as_deref()
        .filter(|c| !c.is_empty())
        .map(|c| format!("after={c}"));

    let mut args: Vec<&str> = vec!["api", "graphql", "-f", &query_arg, "-f", &q_arg];
    if let Some(a) = &after_arg {
        args.push("-f");
        args.push(a);
    }

    // run_gh_raw: a missing manifest is a null blob, not an error, but gh can
    // still exit non-zero on partial GraphQL errors — parse `data` regardless.
    let out = run_gh_raw(None, &args, GH_NETWORK_TIMEOUT).await?;

    let mut page = GithubMcpSearchPage {
        repos: Vec::new(),
        next_cursor: None,
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&out.stdout_lossy()) else {
        return Ok(page);
    };
    let search = &v["data"]["search"];
    if search["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) {
        page.next_cursor = search["pageInfo"]["endCursor"].as_str().map(str::to_string);
    }
    if let Some(nodes) = search["nodes"].as_array() {
        for n in nodes {
            let name_with_owner = n["nameWithOwner"].as_str().unwrap_or("");
            if name_with_owner.is_empty() {
                continue;
            }
            // Blob text is present only for an existing, non-truncated text file.
            let blob = |key: &str| {
                n[key]["text"]
                    .as_str()
                    .filter(|t| !t.is_empty())
                    .map(str::to_string)
            };
            page.repos.push(GithubMcpHit {
                name_with_owner: name_with_owner.to_string(),
                description: n["description"].as_str().map(str::to_string),
                url: n["url"].as_str().unwrap_or("").to_string(),
                server_json: blob("sj"),
                package_json: blob("pj"),
            });
        }
    }
    Ok(page)
}
