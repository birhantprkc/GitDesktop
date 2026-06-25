//! Detecting the gh token's OAuth scopes, so governance UI can prompt for a
//! `gh auth refresh -s <scope>` when a feature needs more access than the user
//! has granted. Read-only and tolerant — any failure reads as "no scopes,
//! non-classic" rather than erroring.

use serde::Serialize;

use crate::error::AppResult;
use crate::github::runner::{run_gh_raw, GH_TIMEOUT};

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GhScopes {
    /// Granted classic OAuth scopes (e.g. ["repo", "read:org"]). Empty for a
    /// fine-grained PAT / GitHub App token, which carry none.
    pub scopes: Vec<String>,
    /// Whether this is a classic OAuth/PAT token whose scopes we can read. A
    /// fine-grained PAT / App token returns no `X-OAuth-Scopes` header → false,
    /// and the UI must NOT then treat "missing scope X" as a problem.
    pub classic: bool,
}

/// The active gh token's OAuth scopes, read from the `X-OAuth-Scopes` response
/// header of `gh api -i user` (the robust detection path — any authenticated
/// REST call returns the granted scopes in that header).
#[tauri::command]
pub async fn gh_token_scopes() -> AppResult<GhScopes> {
    let out = run_gh_raw(None, &["api", "-i", "user"], GH_TIMEOUT).await?;
    if out.code != 0 {
        return Ok(GhScopes::default());
    }
    let body = out.stdout_lossy();
    // Response headers precede the JSON body and end at the first blank line.
    for line in body.lines() {
        if line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("x-oauth-scopes") {
                let scopes = value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                return Ok(GhScopes {
                    scopes,
                    classic: true,
                });
            }
        }
    }
    // No X-OAuth-Scopes header → a fine-grained PAT / App token (no classic scopes).
    Ok(GhScopes::default())
}
