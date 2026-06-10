use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::git::diff::{parse_numstat_z, truncate_at_char_boundary};
use crate::git::runner::{run_git, DEFAULT_TIMEOUT};
use crate::git::types::{CommitSummary, DiffStatEntry, FileDiff, StagedDiff};

/// Commits that distinguish two branches, from the current branch's point of
/// view: `ahead` are on `compare` but not `base`, `behind` are on `base` but
/// not `compare`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparison {
    pub ahead: Vec<CommitSummary>,
    pub behind: Vec<CommitSummary>,
}

/// A ref placed before `--` could be read as an option; reject the obvious
/// injection vectors. Real branch names (incl. `feature/x`) pass fine.
fn validate_ref(name: &str) -> AppResult<()> {
    if name.is_empty() || name.starts_with('-') || name.contains("..") {
        return Err(AppError::InvalidArgument(format!("invalid branch: {name}")));
    }
    Ok(())
}

fn parse_log(text: &str) -> Vec<CommitSummary> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split('\0');
            Some(CommitSummary {
                hash: parts.next()?.to_string(),
                subject: parts.next()?.to_string(),
                author: parts.next()?.to_string(),
                date: parts.next()?.to_string(),
            })
        })
        .collect()
}

async fn log_range(repo_path: &str, range: &str) -> AppResult<Vec<CommitSummary>> {
    let out = run_git(
        Some(repo_path),
        &["log", "--format=%H%x00%s%x00%an%x00%cI", range],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(parse_log(&out.stdout_lossy()))
}

/// Commits unique to each side of `base`/`compare`. `ahead` (compare not in
/// base) is what a PR from `compare` into `base` would introduce; `behind`
/// (base not in compare) is what `compare` is missing.
#[tauri::command]
pub async fn git_compare_branches(
    repo_path: String,
    base: String,
    compare: String,
) -> AppResult<BranchComparison> {
    validate_ref(&base)?;
    validate_ref(&compare)?;
    let ahead = log_range(&repo_path, &format!("{base}..{compare}")).await?;
    let behind = log_range(&repo_path, &format!("{compare}..{base}")).await?;
    Ok(BranchComparison { ahead, behind })
}

/// Files that differ between the merge base of `base`/`compare` and `compare`
/// — i.e. the net change `compare` introduces relative to `base` (the
/// three-dot diff, the same set a PR would show).
#[tauri::command]
pub async fn git_branch_diff_files(
    repo_path: String,
    base: String,
    compare: String,
) -> AppResult<Vec<DiffStatEntry>> {
    validate_ref(&base)?;
    validate_ref(&compare)?;
    let out = run_git(
        Some(&repo_path),
        &[
            "diff",
            "--numstat",
            "-z",
            &format!("{base}...{compare}"),
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(parse_numstat_z(&out.stdout_lossy()))
}

/// The full combined `base...compare` diff text plus its file summary, for
/// feeding AI PR description generation. Mirrors `git_staged_diff`.
#[tauri::command]
pub async fn git_branch_diff(
    repo_path: String,
    base: String,
    compare: String,
    max_bytes: Option<usize>,
) -> AppResult<StagedDiff> {
    validate_ref(&base)?;
    validate_ref(&compare)?;
    let range = format!("{base}...{compare}");
    let text_out = run_git(
        Some(&repo_path),
        &["diff", "--no-color", &range],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let (text, truncated) =
        truncate_at_char_boundary(text_out.stdout_lossy(), max_bytes.unwrap_or(1_000_000));
    let files_out = run_git(
        Some(&repo_path),
        &["diff", "--numstat", "-z", &range],
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
pub async fn git_branch_file_diff(
    repo_path: String,
    base: String,
    compare: String,
    file_path: String,
) -> AppResult<FileDiff> {
    validate_ref(&base)?;
    validate_ref(&compare)?;
    let out = run_git(
        Some(&repo_path),
        &[
            "diff",
            "--no-color",
            &format!("{base}...{compare}"),
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
    let (text, is_truncated) = truncate_at_char_boundary(text, 1_000_000);
    Ok(FileDiff {
        file_path,
        is_binary,
        is_truncated,
        text,
    })
}
