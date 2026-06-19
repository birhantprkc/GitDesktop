use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::github::pr::PrAuthor;
use crate::github::runner::{run_gh, GH_NETWORK_TIMEOUT, GH_TIMEOUT};

// Discussions have no `gh discussion` command and no REST surface — everything
// goes through `gh api graphql`. GraphQL needs explicit owner/name (no
// {owner}/{repo} substitution), so each call resolves them first.

/// `emojiHTML` comes back as `<div>🏎️</div>`; keep just the glyph.
fn strip_html(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

async fn owner_name(repo_path: &str) -> AppResult<(String, String)> {
    let out = run_gh(
        Some(repo_path),
        &["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        GH_TIMEOUT,
    )
    .await?;
    let nwo = out.stdout_lossy().trim().to_string();
    nwo.split_once('/')
        .map(|(o, n)| (o.to_string(), n.to_string()))
        .ok_or_else(|| AppError::Gh("could not determine the repository owner".into()))
}

fn login(a: Option<PrAuthor>) -> String {
    a.map(|x| x.login).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionCategory {
    pub id: String,
    pub name: String,
    /// The category glyph (extracted from emojiHTML), e.g. "🏎️".
    pub emoji: String,
    pub is_answerable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionMeta {
    /// GraphQL node id of the repository — needed to create a discussion.
    pub repo_id: String,
    pub has_discussions_enabled: bool,
    pub categories: Vec<DiscussionCategory>,
}

const META_QUERY: &str = "query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ id hasDiscussionsEnabled discussionCategories(first:50){ nodes{ id name emojiHTML isAnswerable } } } }";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCategory {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    emoji_html: String,
    #[serde(default)]
    is_answerable: bool,
}

/// Repo discussion metadata: node id (for create), whether discussions are
/// enabled, and the categories (for the filter + create picker).
#[tauri::command]
pub async fn gh_discussion_categories(repo_path: String) -> AppResult<DiscussionMeta> {
    let (owner, name) = owner_name(&repo_path).await?;
    let out = run_gh(
        Some(&repo_path),
        &[
            "api",
            "graphql",
            "-F",
            &format!("owner={owner}"),
            "-F",
            &format!("name={name}"),
            "-f",
            &format!("query={META_QUERY}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let value: serde_json::Value = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse discussion categories: {e}")))?;
    let repo = value.pointer("/data/repository");
    let repo_id = repo
        .and_then(|r| r.get("id"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    let has_discussions_enabled = repo
        .and_then(|r| r.get("hasDiscussionsEnabled"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let categories = repo
        .and_then(|r| r.pointer("/discussionCategories/nodes"))
        .cloned()
        .map(|nodes| serde_json::from_value::<Vec<RawCategory>>(nodes).unwrap_or_default())
        .unwrap_or_default()
        .into_iter()
        .map(|c| DiscussionCategory {
            id: c.id,
            name: c.name,
            emoji: strip_html(&c.emoji_html),
            is_answerable: c.is_answerable,
        })
        .collect();
    Ok(DiscussionMeta {
        repo_id,
        has_discussions_enabled,
        categories,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionInfo {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub created_at: String,
    pub is_answered: bool,
    pub closed: bool,
    pub state_reason: Option<String>,
    pub category_name: String,
    pub category_emoji: String,
    pub author: String,
    pub comment_count: u64,
}

const LIST_QUERY: &str = "query($owner:String!,$name:String!,$category:ID){ repository(owner:$owner,name:$name){ discussions(first:50, categoryId:$category, orderBy:{field:UPDATED_AT, direction:DESC}){ nodes{ number title url createdAt isAnswered closed stateReason category{ name emojiHTML } author{ login } comments{ totalCount } } } } }";

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawListCategory {
    #[serde(default)]
    name: String,
    #[serde(default)]
    emoji_html: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawCommentCount {
    #[serde(default)]
    total_count: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDiscussionNode {
    #[serde(default)]
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    created_at: String,
    // Nullable: `isAnswered` is null for non-answerable (non-Q&A) categories.
    #[serde(default)]
    is_answered: Option<bool>,
    #[serde(default)]
    closed: bool,
    #[serde(default)]
    state_reason: Option<String>,
    category: Option<RawListCategory>,
    author: Option<PrAuthor>,
    #[serde(default)]
    comments: RawCommentCount,
}

/// Discussions for the list, newest-updated first. `category` is a category
/// node id to filter by, or empty for all categories. (Discussions have no
/// open/closed tabs — they're filtered by category; `closed`/`stateReason`
/// surface as a badge.)
#[tauri::command]
pub async fn gh_discussion_list(
    repo_path: String,
    category: Option<String>,
) -> AppResult<Vec<DiscussionInfo>> {
    let (owner, name) = owner_name(&repo_path).await?;
    let mut args = vec![
        "api".to_string(),
        "graphql".to_string(),
        "-F".to_string(),
        format!("owner={owner}"),
        "-F".to_string(),
        format!("name={name}"),
    ];
    // Only pass categoryId when filtering; absent leaves the variable null.
    if let Some(cat) = category.as_deref().filter(|c| !c.is_empty()) {
        args.push("-F".to_string());
        args.push(format!("category={cat}"));
    }
    args.push("-f".to_string());
    args.push(format!("query={LIST_QUERY}"));
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run_gh(Some(&repo_path), &arg_refs, GH_NETWORK_TIMEOUT).await?;
    let value: serde_json::Value = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse discussions: {e}")))?;
    // Propagate parse errors instead of silently yielding an empty list.
    let nodes: Vec<RawDiscussionNode> = value
        .pointer("/data/repository/discussions/nodes")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| AppError::Gh(format!("could not parse discussions: {e}")))?
        .unwrap_or_default();
    Ok(nodes
        .into_iter()
        .map(|d| {
            let category = d.category.unwrap_or_default();
            DiscussionInfo {
                number: d.number,
                title: d.title,
                url: d.url,
                created_at: d.created_at,
                is_answered: d.is_answered.unwrap_or(false),
                closed: d.closed,
                state_reason: d.state_reason,
                category_name: category.name,
                category_emoji: strip_html(&category.emoji_html),
                author: login(d.author),
                comment_count: d.comments.total_count,
            }
        })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionReply {
    pub id: String,
    pub author: String,
    pub body: String,
    pub date: String,
    pub viewer_did_author: bool,
    pub is_minimized: bool,
    pub minimized_reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionComment {
    pub id: String,
    pub author: String,
    pub body: String,
    pub date: String,
    pub url: String,
    pub viewer_did_author: bool,
    pub is_minimized: bool,
    pub minimized_reason: String,
    /// Whether this comment is the discussion's accepted answer.
    pub is_answer: bool,
    pub replies: Vec<DiscussionReply>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionDetails {
    pub id: String,
    pub number: u64,
    pub title: String,
    pub body: String,
    pub url: String,
    pub author: String,
    pub created_at: String,
    pub category_name: String,
    pub category_emoji: String,
    /// Whether the category accepts answers (Q&A) — gates "Mark as answer".
    pub is_answerable: bool,
    pub is_answered: bool,
    pub comments: Vec<DiscussionComment>,
}

const VIEW_QUERY: &str = "query($owner:String!,$name:String!,$number:Int!){ repository(owner:$owner,name:$name){ discussion(number:$number){ id number title body url createdAt isAnswered author{login} category{ name emojiHTML isAnswerable } comments(first:100){ nodes{ id body createdAt isAnswer isMinimized minimizedReason viewerDidAuthor url author{login} replies(first:100){ nodes{ id body createdAt isMinimized minimizedReason viewerDidAuthor author{login} } } } } } } }";

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawViewCategory {
    #[serde(default)]
    name: String,
    #[serde(default)]
    emoji_html: String,
    #[serde(default)]
    is_answerable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawReply {
    #[serde(default)]
    id: String,
    author: Option<PrAuthor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    is_minimized: bool,
    #[serde(default)]
    minimized_reason: Option<String>,
    #[serde(default)]
    viewer_did_author: bool,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawReplies {
    #[serde(default)]
    nodes: Vec<RawReply>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDiscussionComment {
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
    is_answer: bool,
    #[serde(default)]
    is_minimized: bool,
    #[serde(default)]
    minimized_reason: Option<String>,
    #[serde(default)]
    viewer_did_author: bool,
    #[serde(default)]
    replies: RawReplies,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawComments {
    #[serde(default)]
    nodes: Vec<RawDiscussionComment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDiscussion {
    #[serde(default)]
    id: String,
    #[serde(default)]
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    created_at: String,
    // Nullable for non-answerable categories (see the list node).
    #[serde(default)]
    is_answered: Option<bool>,
    author: Option<PrAuthor>,
    category: Option<RawViewCategory>,
    #[serde(default)]
    comments: RawComments,
}

/// A discussion's full thread: body + top-level comments, each with its nested
/// replies (GitHub discussions are exactly two levels deep).
#[tauri::command]
pub async fn gh_discussion_view(
    repo_path: String,
    number: u64,
) -> AppResult<DiscussionDetails> {
    let (owner, name) = owner_name(&repo_path).await?;
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
            &format!("query={VIEW_QUERY}"),
        ],
        GH_NETWORK_TIMEOUT,
    )
    .await?;
    let value: serde_json::Value = serde_json::from_str(&out.stdout_lossy())
        .map_err(|e| AppError::Gh(format!("could not parse discussion: {e}")))?;
    let raw: RawDiscussion = value
        .pointer("/data/repository/discussion")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| AppError::Gh(format!("could not parse discussion: {e}")))?
        .ok_or_else(|| AppError::Gh("discussion not found".into()))?;

    let category = raw.category.unwrap_or_default();
    let comments = raw
        .comments
        .nodes
        .into_iter()
        .map(|c| DiscussionComment {
            id: c.id,
            author: login(c.author),
            body: c.body,
            date: c.created_at,
            url: c.url,
            viewer_did_author: c.viewer_did_author,
            is_minimized: c.is_minimized,
            minimized_reason: c.minimized_reason.unwrap_or_default(),
            is_answer: c.is_answer,
            replies: c
                .replies
                .nodes
                .into_iter()
                .map(|r| DiscussionReply {
                    id: r.id,
                    author: login(r.author),
                    body: r.body,
                    date: r.created_at,
                    viewer_did_author: r.viewer_did_author,
                    is_minimized: r.is_minimized,
                    minimized_reason: r.minimized_reason.unwrap_or_default(),
                })
                .collect(),
        })
        .collect();

    Ok(DiscussionDetails {
        id: raw.id,
        number: raw.number,
        title: raw.title,
        body: raw.body,
        url: raw.url,
        author: login(raw.author),
        created_at: raw.created_at,
        category_name: category.name,
        category_emoji: strip_html(&category.emoji_html),
        is_answerable: category.is_answerable,
        is_answered: raw.is_answered.unwrap_or(false),
        comments,
    })
}
