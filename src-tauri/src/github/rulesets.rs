//! Repository rulesets — the modern, layered replacement for classic branch
//! protection. The frontend builds the (large, nested) ruleset JSON to GitHub's
//! schema and we forward it; reads return the raw object for the editor to seed
//! from. `gh ruleset` is read-only, so every write is a raw `gh api`.
//!
//! Key affordance: "disable" is a reversible `enforcement: "disabled"` (the
//! ruleset is retained), NOT a delete — so `gh_ruleset_set_enforcement` does a
//! GET-then-PUT to flip only enforcement without dropping the rules.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::github::runner::{run_gh, run_gh_input, GH_NETWORK_TIMEOUT};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesetSummary {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub enforcement: String,
    /// "Repository" | "Organization" — org rulesets are read-only from a repo.
    #[serde(default, alias = "source_type")]
    pub source_type: String,
}

fn validate_enforcement(e: &str) -> AppResult<()> {
    if !matches!(e, "active" | "evaluate" | "disabled") {
        return Err(AppError::InvalidArgument(format!(
            "invalid enforcement: {e}"
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn gh_rulesets_list(repo_path: String) -> AppResult<Vec<RulesetSummary>> {
    let out = run_gh(
        Some(&repo_path),
        &["api", "repos/{owner}/{repo}/rulesets?per_page=100"],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse rulesets: {e}")))
}

/// The full ruleset object (raw GitHub JSON), for the editor to seed from.
#[tauri::command]
pub async fn gh_ruleset_get(repo_path: String, id: u64) -> AppResult<Value> {
    let out = run_gh(
        Some(&repo_path),
        &["api", &format!("repos/{{owner}}/{{repo}}/rulesets/{id}")],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse the ruleset: {e}")))
}

#[tauri::command]
pub async fn gh_ruleset_create(repo_path: String, body: Value) -> AppResult<()> {
    run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "POST",
            "repos/{owner}/{repo}/rulesets",
            "--input",
            "-",
        ],
        &body.to_string(),
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn gh_ruleset_update(repo_path: String, id: u64, body: Value) -> AppResult<()> {
    run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PUT",
            &format!("repos/{{owner}}/{{repo}}/rulesets/{id}"),
            "--input",
            "-",
        ],
        &body.to_string(),
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn gh_ruleset_delete(repo_path: String, id: u64) -> AppResult<()> {
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "DELETE",
            &format!("repos/{{owner}}/{{repo}}/rulesets/{id}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Flips only `enforcement` (the reversible soft-off). PUT is a full replace, so
/// we GET the ruleset and resend its writable fields with the new enforcement —
/// the rules are preserved.
#[tauri::command]
pub async fn gh_ruleset_set_enforcement(
    repo_path: String,
    id: u64,
    enforcement: String,
) -> AppResult<()> {
    validate_enforcement(&enforcement)?;
    let out = run_gh(
        Some(&repo_path),
        &["api", &format!("repos/{{owner}}/{{repo}}/rulesets/{id}")],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let full: Value = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse the ruleset: {e}")))?;
    let body = json!({
        "name": full.get("name").cloned().unwrap_or(json!("")),
        "target": full.get("target").cloned().unwrap_or(json!("branch")),
        "enforcement": enforcement,
        "bypass_actors": full.get("bypass_actors").cloned().unwrap_or(json!([])),
        "conditions": full.get("conditions").cloned().unwrap_or(json!({})),
        "rules": full.get("rules").cloned().unwrap_or(json!([])),
    });
    gh_ruleset_update(repo_path, id, body).await
}
