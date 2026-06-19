use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::github::pr::{PrAuthor, PrListLabel, PrRef, PrThreadOut, RepoLabel};
use crate::github::runner::{run_gh, run_gh_input, GH_NETWORK_TIMEOUT, GH_TIMEOUT};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub number: u64,
    pub title: String,
}

/// One emoji reaction tally on a reactable subject (issue body or comment).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reaction {
    /// GitHub ReactionContent enum value (THUMBS_UP, HEART, ROCKET, …).
    pub content: String,
    pub count: u64,
    /// Whether the signed-in user has this reaction (drives the toggle).
    pub viewer_reacted: bool,
}

pub fn map_reaction_groups(groups: Option<&serde_json::Value>) -> Vec<Reaction> {
    groups
        .and_then(|g| g.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|g| {
                    let count = g
                        .pointer("/reactors/totalCount")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0);
                    if count == 0 {
                        return None;
                    }
                    Some(Reaction {
                        content: g.get("content")?.as_str()?.to_string(),
                        count,
                        viewer_reacted: g
                            .get("viewerHasReacted")
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

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
    milestone: Option<Milestone>,
    #[serde(default)]
    is_pinned: bool,
    #[serde(default)]
    comments: Vec<RawIssueComment>,
    #[serde(default)]
    labels: Vec<RepoLabel>,
}

/// Lock state isn't exposed by `gh issue view --json`, so it's fetched from the
/// REST issue object in parallel.
#[derive(Deserialize, Default)]
struct LockState {
    #[serde(default)]
    locked: bool,
    #[serde(default)]
    reason: Option<String>,
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
    pub milestone: Option<Milestone>,
    pub is_pinned: bool,
    pub locked: bool,
    pub active_lock_reason: Option<String>,
    pub comments: Vec<PrThreadOut>,
    pub labels: Vec<RepoLabel>,
}

const ISSUE_VIEW_FIELDS: &str =
    "id,number,title,body,author,state,createdAt,url,assignees,milestone,isPinned,comments,labels";

/// Full details for one issue's read view: body, assignees, labels and the
/// conversation comments (with node ids for editing/hiding).
#[tauri::command]
pub async fn gh_issue_view(repo_path: String, number: u64) -> AppResult<IssueDetails> {
    // The conversation view and the (REST-only) lock state are fetched
    // concurrently so the lock state adds no extra round-trip latency.
    let n = number.to_string();
    let issue_path = format!("repos/{{owner}}/{{repo}}/issues/{number}");
    let view_args = ["issue", "view", &n, "--json", ISSUE_VIEW_FIELDS];
    let lock_args = [
        "api",
        &issue_path,
        "--jq",
        "{locked: .locked, reason: .active_lock_reason}",
    ];
    let (view_res, lock_res) = tokio::join!(
        run_gh(Some(&repo_path), &view_args, GH_TIMEOUT),
        run_gh(Some(&repo_path), &lock_args, GH_TIMEOUT),
    );
    let out = view_res?;
    let raw: RawIssue = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse gh issue view: {e}")))?;
    // Best-effort: a failed lock lookup just leaves the issue shown as unlocked.
    let lock: LockState = lock_res
        .ok()
        .and_then(|o| serde_json::from_str(&o.stdout_lossy()).ok())
        .unwrap_or_default();

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
        milestone: raw.milestone,
        is_pinned: raw.is_pinned,
        locked: lock.locked,
        active_lock_reason: lock.reason,
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

#[derive(Deserialize)]
struct CreatedIssue {
    number: u64,
    html_url: String,
}

/// Creates an issue via the REST API so labels/assignees (arrays) and milestone
/// (by number) go in one call and the response carries the new number + URL
/// directly. `labels` and `assignees` are applied by name/login (must exist).
#[tauri::command]
pub async fn gh_issue_create(
    repo_path: String,
    title: String,
    body: String,
    labels: Vec<String>,
    assignees: Vec<String>,
    milestone: Option<u64>,
) -> AppResult<PrRef> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidArgument(
            "an issue title is required".into(),
        ));
    }
    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
        "labels": labels,
        "assignees": assignees,
    });
    if let Some(m) = milestone {
        payload["milestone"] = serde_json::json!(m);
    }
    let input = serde_json::to_string(&payload)
        .map_err(|e| AppError::Gh(format!("could not encode issue: {e}")))?;
    let out = run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "POST",
            "repos/{owner}/{repo}/issues",
            "--input",
            "-",
        ],
        &input,
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let created: CreatedIssue = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse created issue: {e}")))?;
    Ok(PrRef {
        number: created.number,
        url: created.html_url,
    })
}

/// Logins that can be assigned to issues/PRs in this repo (collaborators).
#[tauri::command]
pub async fn gh_assignable_users(repo_path: String) -> AppResult<Vec<String>> {
    let out = run_gh(
        Some(&repo_path),
        &[
            "api",
            "repos/{owner}/{repo}/assignees",
            "--jq",
            "[.[].login]",
        ],
        GH_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse assignable users: {e}")))
}

/// Open milestones for the milestone picker.
#[tauri::command]
pub async fn gh_milestones(repo_path: String) -> AppResult<Vec<Milestone>> {
    let out = run_gh(
        Some(&repo_path),
        &[
            "api",
            "repos/{owner}/{repo}/milestones?state=open&per_page=100",
            "--jq",
            "[.[] | {number, title}]",
        ],
        GH_TIMEOUT,
    )
    .await?;
    serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse milestones: {e}")))
}

/// Replaces an issue's assignees (REST PATCH sends the full desired set).
#[tauri::command]
pub async fn gh_issue_set_assignees(
    repo_path: String,
    number: u64,
    assignees: Vec<String>,
) -> AppResult<()> {
    let input = serde_json::to_string(&serde_json::json!({ "assignees": assignees }))
        .map_err(|e| AppError::Gh(format!("could not encode assignees: {e}")))?;
    run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PATCH",
            &format!("repos/{{owner}}/{{repo}}/issues/{number}"),
            "--input",
            "-",
        ],
        &input,
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Sets (or, with `None`, clears) an issue's milestone by milestone number.
#[tauri::command]
pub async fn gh_issue_set_milestone(
    repo_path: String,
    number: u64,
    milestone: Option<u64>,
) -> AppResult<()> {
    let milestone_value = match milestone {
        Some(m) => serde_json::json!(m),
        None => serde_json::Value::Null,
    };
    let input =
        serde_json::to_string(&serde_json::json!({ "milestone": milestone_value }))
            .map_err(|e| AppError::Gh(format!("could not encode milestone: {e}")))?;
    run_gh_input(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PATCH",
            &format!("repos/{{owner}}/{{repo}}/issues/{number}"),
            "--input",
            "-",
        ],
        &input,
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Adds a standalone comment to the issue conversation.
#[tauri::command]
pub async fn gh_issue_comment(
    repo_path: String,
    number: u64,
    body: String,
) -> AppResult<()> {
    if body.trim().is_empty() {
        return Err(AppError::InvalidArgument("a comment is required".into()));
    }
    let n = number.to_string();
    run_gh(
        Some(&repo_path),
        &["issue", "comment", &n, "--body", &body],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Closes an issue. `reason` is "completed" or "not_planned" (GitHub's two
/// close reasons); empty defaults to completed.
#[tauri::command]
pub async fn gh_issue_close(
    repo_path: String,
    number: u64,
    reason: String,
) -> AppResult<()> {
    let n = number.to_string();
    let reason = match reason.as_str() {
        "" | "completed" => "completed",
        "not_planned" => "not_planned",
        _ => {
            return Err(AppError::InvalidArgument(format!(
                "unknown close reason: {reason}"
            )));
        }
    };
    run_gh(
        Some(&repo_path),
        &["issue", "close", &n, "--reason", reason],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Reopens a closed issue.
#[tauri::command]
pub async fn gh_issue_reopen(repo_path: String, number: u64) -> AppResult<()> {
    let n = number.to_string();
    run_gh(
        Some(&repo_path),
        &["issue", "reopen", &n],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

// `gh issue edit` selects the sunset Projects-classic field on older gh (same
// bug as `gh pr edit`), so title/body edits go through the REST API instead.

/// Updates an issue's title and body via the REST API.
#[tauri::command]
pub async fn gh_issue_edit(
    repo_path: String,
    number: u64,
    title: String,
    body: String,
) -> AppResult<()> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidArgument(
            "an issue title is required".into(),
        ));
    }
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "--method",
            "PATCH",
            &format!("repos/{{owner}}/{{repo}}/issues/{number}"),
            "-f",
            &format!("title={title}"),
            "-f",
            &format!("body={body}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Pins an issue (GitHub allows at most 3 pinned issues; gh surfaces the error).
#[tauri::command]
pub async fn gh_issue_pin(repo_path: String, number: u64) -> AppResult<()> {
    let n = number.to_string();
    run_gh(Some(&repo_path), &["issue", "pin", &n], GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn gh_issue_unpin(repo_path: String, number: u64) -> AppResult<()> {
    let n = number.to_string();
    run_gh(Some(&repo_path), &["issue", "unpin", &n], GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

/// Locks an issue's conversation. `reason`, if given, is one of GitHub's four:
/// off_topic, resolved, spam, too_heated.
#[tauri::command]
pub async fn gh_issue_lock(
    repo_path: String,
    number: u64,
    reason: Option<String>,
) -> AppResult<()> {
    let n = number.to_string();
    let mut args = vec!["issue", "lock", &n];
    if let Some(r) = reason.as_deref() {
        if !matches!(r, "off_topic" | "resolved" | "spam" | "too_heated") {
            return Err(AppError::InvalidArgument(format!(
                "unknown lock reason: {r}"
            )));
        }
        args.push("--reason");
        args.push(r);
    }
    run_gh(Some(&repo_path), &args, GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn gh_issue_unlock(repo_path: String, number: u64) -> AppResult<()> {
    let n = number.to_string();
    run_gh(Some(&repo_path), &["issue", "unlock", &n], GH_NETWORK_TIMEOUT).await?;
    Ok(())
}

/// Reactions for an issue's body + each comment (keyed by comment node id).
/// Kept separate from `gh_issue_view` so it loads in parallel and adds no
/// latency to the conversation — `viewerHasReacted` requires GraphQL, which the
/// `gh issue view` CLI JSON doesn't expose.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueReactions {
    pub body: Vec<Reaction>,
    pub comments: std::collections::HashMap<String, Vec<Reaction>>,
}

const REACTIONS_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){ repository(owner:$owner,name:$name){ issue(number:$number){ reactionGroups{ content viewerHasReacted reactors{ totalCount } } comments(first:100){ nodes{ id reactionGroups{ content viewerHasReacted reactors{ totalCount } } } } } } }";

#[tauri::command]
pub async fn gh_issue_reactions(
    repo_path: String,
    number: u64,
) -> AppResult<IssueReactions> {
    // GraphQL needs explicit owner/name (no {owner}/{repo} substitution).
    let owner_out = run_gh(
        Some(&repo_path),
        &["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        GH_TIMEOUT,
    )
    .await?;
    let name_with_owner = owner_out.stdout_lossy().trim().to_string();
    let Some((owner, name)) = name_with_owner.split_once('/') else {
        return Err(AppError::Gh(
            "could not determine the repository owner".into(),
        ));
    };

    // owner/name/number go in as typed variables (no string interpolation).
    let out = run_gh(
        Some(&repo_path),
        &[
            "api",
            "graphql",
            "-F",
            &format!("owner={owner}"),
            "-F",
            &format!("name={name}"),
            "-F",
            &format!("number={number}"),
            "-f",
            &format!("query={REACTIONS_QUERY}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let value: serde_json::Value = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse reactions: {e}")))?;
    let issue = value.pointer("/data/repository/issue");

    let body = map_reaction_groups(issue.and_then(|i| i.get("reactionGroups")));
    let mut comments = std::collections::HashMap::new();
    if let Some(nodes) = issue
        .and_then(|i| i.pointer("/comments/nodes"))
        .and_then(|n| n.as_array())
    {
        for node in nodes {
            if let Some(id) = node.get("id").and_then(serde_json::Value::as_str) {
                let reactions = map_reaction_groups(node.get("reactionGroups"));
                if !reactions.is_empty() {
                    comments.insert(id.to_string(), reactions);
                }
            }
        }
    }

    Ok(IssueReactions { body, comments })
}

fn validate_reaction_content(content: &str) -> AppResult<()> {
    if matches!(
        content,
        "THUMBS_UP"
            | "THUMBS_DOWN"
            | "LAUGH"
            | "HOORAY"
            | "CONFUSED"
            | "HEART"
            | "ROCKET"
            | "EYES"
    ) {
        Ok(())
    } else {
        Err(AppError::InvalidArgument(format!(
            "unknown reaction: {content}"
        )))
    }
}

/// Adds the viewer's reaction to any reactable subject (issue/PR body or
/// comment) by its GraphQL node id. Generic — reusable for PRs later.
#[tauri::command]
pub async fn gh_add_reaction(
    repo_path: String,
    subject_id: String,
    content: String,
) -> AppResult<()> {
    validate_reaction_content(&content)?;
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "graphql",
            "-f",
            "query=mutation($id:ID!,$content:ReactionContent!){ addReaction(input:{subjectId:$id,content:$content}){ clientMutationId } }",
            "-f",
            &format!("id={subject_id}"),
            "-f",
            &format!("content={content}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn gh_remove_reaction(
    repo_path: String,
    subject_id: String,
    content: String,
) -> AppResult<()> {
    validate_reaction_content(&content)?;
    run_gh(
        Some(&repo_path),
        &[
            "api",
            "graphql",
            "-f",
            "query=mutation($id:ID!,$content:ReactionContent!){ removeReaction(input:{subjectId:$id,content:$content}){ clientMutationId } }",
            "-f",
            &format!("id={subject_id}"),
            "-f",
            &format!("content={content}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Strips a leading YAML frontmatter block (`---\n…\n---`) from a template body.
fn strip_frontmatter(text: &str) -> String {
    let trimmed = text.trim_start_matches(['\u{feff}', '\n', '\r', ' ']);
    if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            return rest[end + 4..].trim_start().to_string();
        }
    }
    text.to_string()
}

/// Reads the repository's issue templates so the AI issue drafter can follow the
/// project's expected structure: the `.github/ISSUE_TEMPLATE/` directory first
/// (each markdown template, frontmatter stripped), else the legacy single-file
/// locations. Best-effort — returns an empty list when the repo has none.
#[tauri::command]
pub fn read_issue_templates(repo_path: String) -> AppResult<Vec<String>> {
    let root = Path::new(&repo_path);
    let mut out: Vec<String> = Vec::new();

    let dir = root.join(".github").join("ISSUE_TEMPLATE");
    if let Ok(entries) = fs::read_dir(&dir) {
        let mut paths: Vec<_> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                matches!(
                    p.extension().and_then(|x| x.to_str()),
                    Some("md") | Some("markdown")
                )
            })
            .collect();
        paths.sort();
        for path in paths {
            if let Ok(text) = fs::read_to_string(&path) {
                let body = strip_frontmatter(&text);
                if !body.trim().is_empty() {
                    out.push(body);
                }
            }
        }
    }

    // Fall back to the legacy single-file templates only if the dir had none.
    if out.is_empty() {
        for rel in [
            ".github/ISSUE_TEMPLATE.md",
            ".github/issue_template.md",
            "ISSUE_TEMPLATE.md",
            "docs/ISSUE_TEMPLATE.md",
        ] {
            if let Ok(text) = fs::read_to_string(root.join(rel)) {
                let body = strip_frontmatter(&text);
                if !body.trim().is_empty() {
                    out.push(body);
                    break;
                }
            }
        }
    }

    Ok(out)
}
