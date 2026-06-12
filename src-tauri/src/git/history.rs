use crate::error::AppResult;
use crate::git::diff::parse_numstat_z;
use crate::git::runner::{run_git, run_git_raw, DEFAULT_TIMEOUT};
use crate::git::types::{CommitDetails, CommitSummary, DiffStatEntry, FileDiff, StagedDiff};

pub fn validate_hash(hash: &str) -> AppResult<()> {
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::InvalidArgument(format!(
            "invalid commit hash: {hash}"
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn git_log(
    repo_path: String,
    limit: u32,
    skip: u32,
) -> AppResult<Vec<CommitSummary>> {
    let head_exists = run_git_raw(
        Some(&repo_path),
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?
    .code
        == 0;
    if !head_exists {
        return Ok(Vec::new());
    }

    let limit_arg = limit.to_string();
    let skip_arg = skip.to_string();
    let out = run_git(
        Some(&repo_path),
        &[
            "log",
            "-n",
            &limit_arg,
            "--skip",
            &skip_arg,
            "--format=%H%x00%s%x00%an%x00%cI%x00%D%x00%P",
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let text = out.stdout_lossy();
    Ok(text
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\0');
            Some(CommitSummary {
                hash: parts.next()?.to_string(),
                subject: parts.next()?.to_string(),
                author: parts.next()?.to_string(),
                date: parts.next()?.to_string(),
                // %D: "HEAD -> main, tag: v1.0, origin/main" — keep the tags.
                tags: parts
                    .next()
                    .unwrap_or("")
                    .split(", ")
                    .filter_map(|d| d.strip_prefix("tag: "))
                    .map(str::to_string)
                    .collect(),
                // %P: space-separated parent hashes.
                is_merge: parts.next().unwrap_or("").split_whitespace().count() > 1,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn git_commit_details(repo_path: String, hash: String) -> AppResult<CommitDetails> {
    validate_hash(&hash)?;
    // -z terminates the record so the multi-line body (%b) parses unambiguously
    let out = run_git(
        Some(&repo_path),
        &[
            "log",
            "-1",
            "-z",
            "--format=%H%x00%s%x00%an%x00%ae%x00%cI%x00%b",
            &hash,
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let text = out.stdout_lossy();
    let record = text.trim_end_matches('\0');
    let mut parts = record.splitn(6, '\0');
    let (Some(hash), Some(subject), Some(author), Some(author_email), Some(date)) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Err(crate::error::AppError::Git {
            code: 0,
            stderr: "unexpected git log output".into(),
        });
    };
    let body = parts.next().unwrap_or("").trim().to_string();

    Ok(CommitDetails {
        hash: hash.to_string(),
        subject: subject.to_string(),
        body,
        author: author.to_string(),
        author_email: author_email.to_string(),
        date: date.to_string(),
    })
}

/// Files changed by a commit. `-m --first-parent` makes merge commits show
/// their diff against the first parent (like GitHub), and `show` handles the
/// root commit by diffing against the empty tree.
#[tauri::command]
pub async fn git_commit_files(repo_path: String, hash: String) -> AppResult<Vec<DiffStatEntry>> {
    validate_hash(&hash)?;
    let out = run_git(
        Some(&repo_path),
        &[
            "show",
            "-m",
            "--first-parent",
            "--numstat",
            "-z",
            "--format=",
            &hash,
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(parse_numstat_z(&out.stdout_lossy()))
}

/// The combined diff a commit introduced (vs its first parent) plus numstat —
/// the commit-shaped analogue of `git_branch_diff`, used for AI review.
#[tauri::command]
pub async fn git_commit_diff(
    repo_path: String,
    hash: String,
    max_bytes: Option<usize>,
) -> AppResult<StagedDiff> {
    validate_hash(&hash)?;
    let text_out = run_git(
        Some(&repo_path),
        &[
            "show",
            "-m",
            "--first-parent",
            "--no-color",
            "--format=",
            &hash,
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let (text, truncated) = super::diff::truncate_at_char_boundary(
        text_out.stdout_lossy(),
        max_bytes.unwrap_or(1_000_000),
    );
    let files_out = run_git(
        Some(&repo_path),
        &[
            "show",
            "-m",
            "--first-parent",
            "--numstat",
            "-z",
            "--format=",
            &hash,
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(StagedDiff {
        text,
        truncated,
        files: parse_numstat_z(&files_out.stdout_lossy()),
        excluded_files: 0,
    })
}

#[tauri::command]
pub async fn git_commit_file_diff(
    repo_path: String,
    hash: String,
    file_path: String,
) -> AppResult<FileDiff> {
    validate_hash(&hash)?;
    let out = run_git(
        Some(&repo_path),
        &[
            "show",
            "-m",
            "--first-parent",
            "--no-color",
            "--format=",
            &hash,
            "--",
            &file_path,
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let text = out.stdout_lossy();
    let is_binary = text
        .lines()
        .any(|l| l.starts_with("Binary files ") && l.ends_with(" differ"));
    let (text, is_truncated) = super::diff::truncate_at_char_boundary(text, 1_000_000);
    Ok(FileDiff {
        file_path,
        is_binary,
        is_truncated,
        text,
    })
}
