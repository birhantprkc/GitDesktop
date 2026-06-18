//! Admin-gated management of a remote GitHub repo: detecting admin access and
//! managing webhooks. All calls go through the `gh` CLI (see `runner`), so they
//! ride the user's existing `gh` token — a missing scope surfaces as gh's own
//! error, which the UI turns into a "run `gh auth refresh`" hint.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::github::runner::{
    run_gh, run_gh_input, run_gh_raw, GH_NETWORK_TIMEOUT, GH_TIMEOUT,
};

/// Whether the signed-in user is an admin on this repo. Gates the
/// repo-settings / webhooks UI. Reads the viewer's `permissions.admin`; a repo
/// without a GitHub remote (or no access) simply reads as `false` rather than
/// erroring — mirrors how `gh_branch_protections` tolerates non-admins.
#[tauri::command]
pub async fn gh_repo_admin(repo_path: String) -> AppResult<bool> {
    let out = run_gh_raw(
        Some(&repo_path),
        &["api", "repos/{owner}/{repo}", "-q", ".permissions.admin"],
        GH_TIMEOUT,
    )
    .await?;
    if out.code != 0 {
        return Ok(false);
    }
    Ok(out.stdout_lossy().trim() == "true")
}

// ── Webhooks ─────────────────────────────────────────────────────────────────
//
// Structs double as the GitHub-response deserialize target (snake_case via
// field `alias`) and the camelCase frontend payload (via `rename_all`).

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebhookConfig {
    #[serde(default)]
    pub url: String,
    #[serde(default, alias = "content_type")]
    pub content_type: String,
    /// "0" (verify SSL) or "1" (skip verification).
    #[serde(default, alias = "insecure_ssl")]
    pub insecure_ssl: String,
    /// GitHub returns "********" when a secret is set and omits it otherwise —
    /// so this only tells the UI whether a secret exists, never its value.
    #[serde(default)]
    pub secret: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebhookLastResponse {
    pub code: Option<u32>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Webhook {
    pub id: u64,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub config: WebhookConfig,
    #[serde(default, alias = "updated_at")]
    pub updated_at: String,
    #[serde(default, alias = "last_response")]
    pub last_response: WebhookLastResponse,
}

/// New/edited webhook values from the UI (camelCase from the frontend).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookInput {
    pub url: String,
    /// "json" or "form".
    pub content_type: String,
    /// A new secret; `None`/empty means leave the existing one unchanged.
    pub secret: Option<String>,
    pub insecure_ssl: bool,
    pub events: Vec<String>,
    pub active: bool,
}

fn validate_hook_input(input: &WebhookInput) -> AppResult<()> {
    let url = input.url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::InvalidArgument(
            "a webhook payload URL (http/https) is required".into(),
        ));
    }
    if input.content_type != "json" && input.content_type != "form" {
        return Err(AppError::InvalidArgument(format!(
            "invalid content type: {}",
            input.content_type
        )));
    }
    if input.events.is_empty() {
        return Err(AppError::InvalidArgument(
            "select at least one event".into(),
        ));
    }
    Ok(())
}

/// The `gh api --input -` JSON body. `include_name` is set on create (GitHub
/// requires `"name":"web"` then, and rejects it on update). A blank secret is
/// omitted so an edit never clears an existing one.
fn build_hook_body(input: &WebhookInput, include_name: bool) -> serde_json::Value {
    let mut config = json!({
        "url": input.url.trim(),
        "content_type": input.content_type,
        "insecure_ssl": if input.insecure_ssl { "1" } else { "0" },
    });
    if let Some(secret) = input.secret.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        config["secret"] = json!(secret);
    }
    let mut body = json!({
        "active": input.active,
        "events": input.events,
        "config": config,
    });
    if include_name {
        body["name"] = json!("web");
    }
    body
}

/// All webhooks on the repo (admin only — non-admins get gh's permission error).
#[tauri::command]
pub async fn gh_hooks_list(repo_path: String) -> AppResult<Vec<Webhook>> {
    let out = run_gh(
        Some(&repo_path),
        &["api", "--paginate", "repos/{owner}/{repo}/hooks"],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse webhooks: {e}")))
}

#[tauri::command]
pub async fn gh_hook_create(repo_path: String, input: WebhookInput) -> AppResult<Webhook> {
    validate_hook_input(&input)?;
    let body = build_hook_body(&input, true);
    let out = run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "POST",
            "repos/{owner}/{repo}/hooks",
            "--input",
            "-",
        ],
        &body.to_string(),
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse the webhook: {e}")))
}

#[tauri::command]
pub async fn gh_hook_update(
    repo_path: String,
    id: u64,
    input: WebhookInput,
) -> AppResult<Webhook> {
    validate_hook_input(&input)?;
    let body = build_hook_body(&input, false);
    let out = run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PATCH",
            &format!("repos/{{owner}}/{{repo}}/hooks/{id}"),
            "--input",
            "-",
        ],
        &body.to_string(),
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse the webhook: {e}")))
}

#[tauri::command]
pub async fn gh_hook_delete(repo_path: String, id: u64) -> AppResult<()> {
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "DELETE",
            &format!("repos/{{owner}}/{{repo}}/hooks/{id}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Sends a `ping` event to the webhook (GitHub's "redeliver a ping").
#[tauri::command]
pub async fn gh_hook_ping(repo_path: String, id: u64) -> AppResult<()> {
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "POST",
            &format!("repos/{{owner}}/{{repo}}/hooks/{id}/pings"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Triggers a test `push` event (push-event hooks only; GitHub errors otherwise).
#[tauri::command]
pub async fn gh_hook_test(repo_path: String, id: u64) -> AppResult<()> {
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "POST",
            &format!("repos/{{owner}}/{{repo}}/hooks/{id}/tests"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

// ── General settings ─────────────────────────────────────────────────────────
//
// A curated subset of `GET`/`PATCH /repos/{owner}/{repo}` — the safe, common
// settings. Deliberately excludes destructive ones (visibility, archive,
// rename, transfer, delete).

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoSettings {
    /// null in the API when empty.
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    /// Repo topics — present on the repo object, but written via a separate
    /// `PUT /topics` endpoint (see `gh_repo_settings_update`).
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default, alias = "default_branch")]
    pub default_branch: String,
    #[serde(default, alias = "has_issues")]
    pub has_issues: bool,
    #[serde(default, alias = "has_projects")]
    pub has_projects: bool,
    #[serde(default, alias = "has_wiki")]
    pub has_wiki: bool,
    #[serde(default, alias = "has_discussions")]
    pub has_discussions: bool,
    #[serde(default, alias = "allow_squash_merge")]
    pub allow_squash_merge: bool,
    #[serde(default, alias = "allow_merge_commit")]
    pub allow_merge_commit: bool,
    #[serde(default, alias = "allow_rebase_merge")]
    pub allow_rebase_merge: bool,
    #[serde(default, alias = "allow_update_branch")]
    pub allow_update_branch: bool,
    #[serde(default, alias = "delete_branch_on_merge")]
    pub delete_branch_on_merge: bool,
    #[serde(default, alias = "allow_auto_merge")]
    pub allow_auto_merge: bool,
    #[serde(default, alias = "web_commit_signoff_required")]
    pub web_commit_signoff_required: bool,
}

/// Edited settings from the UI (camelCase from the frontend).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSettingsInput {
    pub description: String,
    pub homepage: String,
    pub topics: Vec<String>,
    pub default_branch: String,
    pub has_issues: bool,
    pub has_projects: bool,
    pub has_wiki: bool,
    pub has_discussions: bool,
    pub allow_squash_merge: bool,
    pub allow_merge_commit: bool,
    pub allow_rebase_merge: bool,
    pub allow_update_branch: bool,
    pub delete_branch_on_merge: bool,
    pub allow_auto_merge: bool,
    pub web_commit_signoff_required: bool,
}

#[tauri::command]
pub async fn gh_repo_settings_get(repo_path: String) -> AppResult<RepoSettings> {
    let out = run_gh(
        Some(&repo_path),
        &["api", "repos/{owner}/{repo}"],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse repo settings: {e}")))
}

#[tauri::command]
pub async fn gh_repo_settings_update(
    repo_path: String,
    input: RepoSettingsInput,
) -> AppResult<RepoSettings> {
    // GitHub rejects a repo with no merge method enabled.
    if !(input.allow_squash_merge || input.allow_merge_commit || input.allow_rebase_merge) {
        return Err(AppError::InvalidArgument(
            "enable at least one merge method".into(),
        ));
    }
    let body = json!({
        "description": input.description.trim(),
        "homepage": input.homepage.trim(),
        "default_branch": input.default_branch,
        "has_issues": input.has_issues,
        "has_projects": input.has_projects,
        "has_wiki": input.has_wiki,
        "has_discussions": input.has_discussions,
        "allow_squash_merge": input.allow_squash_merge,
        "allow_merge_commit": input.allow_merge_commit,
        "allow_rebase_merge": input.allow_rebase_merge,
        "allow_update_branch": input.allow_update_branch,
        "delete_branch_on_merge": input.delete_branch_on_merge,
        "allow_auto_merge": input.allow_auto_merge,
        "web_commit_signoff_required": input.web_commit_signoff_required,
    });
    let out = run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PATCH",
            "repos/{owner}/{repo}",
            "--input",
            "-",
        ],
        &body.to_string(),
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let mut settings: RepoSettings = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse repo settings: {e}")))?;

    // Topics aren't part of the repo PATCH — they have their own endpoint.
    // Lowercase + strip to GitHub's allowed alphabet so a stray character
    // doesn't 422 the whole save.
    let names: Vec<String> = input
        .topics
        .iter()
        .map(|t| {
            t.trim()
                .to_lowercase()
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect::<String>()
        })
        .filter(|t| !t.is_empty())
        .collect();
    let topics_out = run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PUT",
            "repos/{owner}/{repo}/topics",
            "--input",
            "-",
        ],
        &json!({ "names": names }).to_string(),
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    #[derive(Deserialize)]
    struct TopicsResp {
        #[serde(default)]
        names: Vec<String>,
    }
    if let Ok(t) = serde_json::from_str::<TopicsResp>(&topics_out.stdout_lossy()) {
        settings.topics = t.names;
    }
    Ok(settings)
}
