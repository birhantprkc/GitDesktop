//! GitHub Actions support, driven through the `gh` CLI (`gh run …` /
//! `gh workflow …`). Read views list and inspect workflow runs; mutations
//! re-run, cancel, and manually dispatch workflows. All repo-scoped via the
//! working directory, like the PR commands.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::github::runner::{run_gh, run_gh_raw, GH_NETWORK_TIMEOUT};

/// gh emits `null` for a not-yet-decided conclusion (and timestamps that
/// haven't happened); fold those into "" so the frontend sees a plain string.
fn de_null_string<'de, D>(d: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

fn validate_ref(name: &str) -> AppResult<()> {
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid ref: {name}")));
    }
    Ok(())
}

/// One workflow run in the list view.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    #[serde(rename(serialize = "id", deserialize = "databaseId"))]
    pub id: u64,
    #[serde(default)]
    pub number: u64,
    #[serde(default)]
    pub display_title: String,
    /// "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending".
    #[serde(default)]
    pub status: String,
    /// "success" | "failure" | "cancelled" | … ; "" while still running.
    #[serde(default, deserialize_with = "de_null_string")]
    pub conclusion: String,
    #[serde(default)]
    pub workflow_name: String,
    #[serde(default)]
    pub head_branch: String,
    #[serde(default)]
    pub event: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub head_sha: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStep {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, deserialize_with = "de_null_string")]
    pub conclusion: String,
    #[serde(default)]
    pub number: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunJob {
    #[serde(rename(serialize = "id", deserialize = "databaseId"))]
    pub id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, deserialize_with = "de_null_string")]
    pub conclusion: String,
    #[serde(default, deserialize_with = "de_null_string")]
    pub started_at: String,
    #[serde(default, deserialize_with = "de_null_string")]
    pub completed_at: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub steps: Vec<RunStep>,
}

/// A run plus its jobs/steps, for the detail view.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    #[serde(rename(serialize = "id", deserialize = "databaseId"))]
    pub id: u64,
    #[serde(default)]
    pub number: u64,
    #[serde(default)]
    pub display_title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, deserialize_with = "de_null_string")]
    pub conclusion: String,
    #[serde(default)]
    pub workflow_name: String,
    #[serde(default)]
    pub head_branch: String,
    #[serde(default)]
    pub event: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub head_sha: String,
    #[serde(default)]
    pub jobs: Vec<RunJob>,
}

/// A repo workflow, for the "Run workflow" picker.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub path: String,
    /// "active" | "disabled_manually" | "disabled_inactivity".
    #[serde(default)]
    pub state: String,
}

const RUN_LIST_FIELDS: &str = "databaseId,number,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,updatedAt,url,headSha";
const RUN_VIEW_FIELDS: &str = "databaseId,number,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,url,headSha,jobs";
/// Failed-step logs can run to many MB; keep the tail (failures land at the end).
const RUN_LOG_CAP: usize = 200_000;

/// Recent workflow runs, newest first; optionally scoped to one branch.
#[tauri::command]
pub async fn gh_run_list(
    repo_path: String,
    limit: u32,
    branch: Option<String>,
) -> AppResult<Vec<WorkflowRun>> {
    let limit = limit.clamp(1, 100).to_string();
    let mut args: Vec<&str> = vec![
        "run",
        "list",
        "-L",
        limit.as_str(),
        "--json",
        RUN_LIST_FIELDS,
    ];
    if let Some(b) = branch.as_deref().filter(|s| !s.is_empty()) {
        validate_ref(b)?;
        args.push("--branch");
        args.push(b);
    }
    let out = run_gh(Some(&repo_path), &args, GH_NETWORK_TIMEOUT).await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh run list: {e}")))
}

/// One run with its jobs and steps.
#[tauri::command]
pub async fn gh_run_view(repo_path: String, run_id: u64) -> AppResult<RunDetail> {
    let id = run_id.to_string();
    let out = run_gh(
        Some(&repo_path),
        &["run", "view", &id, "--json", RUN_VIEW_FIELDS],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh run view: {e}")))
}

/// Re-runs a completed run — all jobs, or only the failed ones.
#[tauri::command]
pub async fn gh_run_rerun(repo_path: String, run_id: u64, failed: bool) -> AppResult<()> {
    let id = run_id.to_string();
    let mut args = vec!["run", "rerun", id.as_str()];
    if failed {
        args.push("--failed");
    }
    run_gh(Some(&repo_path), &args, GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

/// Cancels an in-progress run.
#[tauri::command]
pub async fn gh_run_cancel(repo_path: String, run_id: u64) -> AppResult<()> {
    let id = run_id.to_string();
    run_gh(
        Some(&repo_path),
        &["run", "cancel", &id],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Logs of only the failed steps (`gh run view --log-failed`), tail-capped.
/// Read raw because gh exits non-zero on a failed run.
#[tauri::command]
pub async fn gh_run_failed_logs(repo_path: String, run_id: u64) -> AppResult<String> {
    let id = run_id.to_string();
    let out = run_gh_raw(
        Some(&repo_path),
        &["run", "view", &id, "--log-failed"],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let mut text = out.stdout_lossy();
    if text.trim().is_empty() {
        // No failed-step logs (e.g. cancelled, or still running) — surface gh's
        // own message instead of an empty pane.
        text = out.stderr.trim().to_string();
    }
    if text.len() > RUN_LOG_CAP {
        let mut start = text.len() - RUN_LOG_CAP;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        text = format!("…(earlier output truncated)\n{}", &text[start..]);
    }
    Ok(text)
}

/// Logs for one job, for AI debugging. Prefers the failed-step logs (highest
/// signal); falls back to the full job log when gh returns nothing for
/// `--log-failed`. Tighter cap than the run-level logs since this is fed to a
/// model. Read raw because gh exits non-zero on a failed run.
const JOB_LOG_CAP: usize = 60_000;

#[tauri::command]
pub async fn gh_job_logs(repo_path: String, job_id: u64) -> AppResult<String> {
    let id = job_id.to_string();
    let mut out = run_gh_raw(
        Some(&repo_path),
        &["run", "view", "--job", &id, "--log-failed"],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let mut text = out.stdout_lossy();
    if text.trim().is_empty() {
        out = run_gh_raw(
            Some(&repo_path),
            &["run", "view", "--job", &id, "--log"],
            GH_NETWORK_TIMEOUT,
        )
        .await?;
        text = out.stdout_lossy();
    }
    if text.trim().is_empty() {
        text = out.stderr.trim().to_string();
    }
    if text.len() > JOB_LOG_CAP {
        let mut start = text.len() - JOB_LOG_CAP;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        text = format!("…(earlier output truncated)\n{}", &text[start..]);
    }
    Ok(text)
}

/// The repo's workflows, for the manual-dispatch picker.
#[tauri::command]
pub async fn gh_workflow_list(repo_path: String) -> AppResult<Vec<Workflow>> {
    let out = run_gh(
        Some(&repo_path),
        &["workflow", "list", "--all", "--json", "id,name,path,state"],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh workflow list: {e}")))
}

/// Manually dispatches a workflow (`workflow_dispatch`) on a ref, with inputs.
/// `workflow` is the numeric id or the file name (e.g. "ci.yml").
#[tauri::command]
pub async fn gh_workflow_run(
    repo_path: String,
    workflow: String,
    git_ref: String,
    inputs: HashMap<String, String>,
) -> AppResult<()> {
    if workflow.is_empty() || workflow.starts_with('-') {
        return Err(AppError::InvalidArgument(format!(
            "invalid workflow: {workflow}"
        )));
    }
    validate_ref(&git_ref)?;
    let mut args: Vec<String> = vec![
        "workflow".into(),
        "run".into(),
        workflow,
        "--ref".into(),
        git_ref,
    ];
    for (k, v) in &inputs {
        if k.is_empty() || k.starts_with('-') {
            return Err(AppError::InvalidArgument(format!("invalid input key: {k}")));
        }
        args.push("-f".into());
        args.push(format!("{k}={v}"));
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_gh(Some(&repo_path), &arg_refs, GH_NETWORK_TIMEOUT).await?;
    Ok(())
}
