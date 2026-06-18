use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::github::pr::{PrAuthor, PrListLabel, PrThreadOut, RepoLabel};
use crate::github::runner::{run_gh, GH_TIMEOUT};

// Issues mirror the Pull Request feature: `gh issue` covers the REST surface
// 1:1 (and `gh issue list` already excludes PRs), and the comment node ids it
// returns let the shared GraphQL comment/label mutations work unchanged.

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueInfo {
    pub number: u64,
    pub url: String,
    pub title: String,
    /// "OPEN" or "CLOSED".
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    // Defaults tolerate the ghost author and label-less issues.
    #[serde(default)]
    pub author: Option<PrAuthor>,
    #[serde(default)]
    pub labels: Vec<PrListLabel>,
}

const ISSUE_LIST_FIELDS: &str =
    "number,url,title,state,author,labels,createdAt,updatedAt";

/// Issues for the Issues list. `state` is "open" or "closed". `gh issue list`
/// already excludes pull requests, so no extra filtering is needed.
#[tauri::command]
pub async fn gh_issue_list(repo_path: String, state: String) -> AppResult<Vec<IssueInfo>> {
    let args: &[&str] = match state.as_str() {
        "open" => &["issue", "list", "--state", "open", "--json", ISSUE_LIST_FIELDS],
        "closed" => &["issue", "list", "--state", "closed", "--json", ISSUE_LIST_FIELDS],
        _ => {
            return Err(AppError::InvalidArgument(format!(
                "unknown issue state filter: {state}"
            )));
        }
    };
    let out = run_gh(Some(&repo_path), args, GH_TIMEOUT).await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh issue list: {e}")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIssueComment {
    #[serde(default)]
    id: String,
    author: Option<PrAuthor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    is_minimized: bool,
    #[serde(default)]
    minimized_reason: String,
    #[serde(default)]
    viewer_did_author: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIssue {
    #[serde(default)]
    id: String,
    #[serde(default)]
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
    author: Option<PrAuthor>,
    #[serde(default)]
    state: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    assignees: Vec<PrAuthor>,
    #[serde(default)]
    comments: Vec<RawIssueComment>,
    #[serde(default)]
    labels: Vec<RepoLabel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetails {
    /// GraphQL node id, used by the label mutations.
    pub id: String,
    pub number: u64,
    pub title: String,
    pub body: String,
    pub author: String,
    pub state: String,
    pub created_at: String,
    pub url: String,
    pub assignees: Vec<String>,
    pub comments: Vec<PrThreadOut>,
    pub labels: Vec<RepoLabel>,
}

const ISSUE_VIEW_FIELDS: &str =
    "id,number,title,body,author,state,createdAt,url,assignees,comments,labels";

/// Full details for one issue's read view: body, assignees, labels and the
/// conversation comments (with node ids for editing/hiding).
#[tauri::command]
pub async fn gh_issue_view(repo_path: String, number: u64) -> AppResult<IssueDetails> {
    let out = run_gh(
        Some(&repo_path),
        &["issue", "view", &number.to_string(), "--json", ISSUE_VIEW_FIELDS],
        GH_TIMEOUT,
    )
    .await?;
    let raw: RawIssue = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh issue view: {e}")))?;

    Ok(IssueDetails {
        id: raw.id,
        number: raw.number,
        title: raw.title,
        body: raw.body,
        author: raw.author.map(|a| a.login).unwrap_or_default(),
        state: raw.state,
        created_at: raw.created_at,
        url: raw.url,
        assignees: raw.assignees.into_iter().map(|a| a.login).collect(),
        comments: raw
            .comments
            .into_iter()
            .map(|c| PrThreadOut {
                author: c.author.map(|a| a.login).unwrap_or_default(),
                state: String::new(),
                body: c.body,
                date: c.created_at,
                id: c.id,
                url: c.url,
                viewer_did_author: c.viewer_did_author,
                is_minimized: c.is_minimized,
                minimized_reason: c.minimized_reason,
            })
            .collect(),
        labels: raw.labels,
    })
}
