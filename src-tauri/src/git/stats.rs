use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::git::runner::{run_git, run_git_raw, DEFAULT_TIMEOUT};

/// One full-history `git log` pass plus a working-tree scan can outlast the
/// default timeout on very large repositories.
const STATS_TIMEOUT: Duration = Duration::from_secs(120);

/// Files larger than this are sized but not read for line counting — anything
/// this big is generated output or an asset, not hand-written code.
const MAX_COUNTED_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageStat {
    pub name: String,
    pub files: u32,
    pub lines: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributorStat {
    pub name: String,
    pub commits: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStats {
    pub commit_count: u64,
    pub branch_count: u32,
    pub tag_count: u32,
    pub contributor_count: u32,
    /// Most-active authors first, capped at five.
    pub top_contributors: Vec<ContributorStat>,
    pub first_commit_date: Option<String>,
    pub last_commit_date: Option<String>,
    pub tracked_files: u32,
    /// Size of the tracked files as they sit in the working tree.
    pub tracked_bytes: u64,
    /// Size of the .git directory (objects, packs, refs).
    pub git_dir_bytes: u64,
    /// Lines across all tracked text files (binaries excluded).
    pub total_lines: u64,
    /// Per-language line/byte makeup, largest line count first.
    pub languages: Vec<LanguageStat>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStats {
    /// Commits on the branch that the base branch doesn't have.
    pub commit_count: u64,
    pub contributor_count: u32,
    pub top_contributors: Vec<ContributorStat>,
    pub first_commit_date: Option<String>,
    pub last_commit_date: Option<String>,
    /// Diff vs the merge base with the base branch.
    pub files_changed: u32,
    pub additions: u64,
    pub deletions: u64,
}

/// Display-name for a tracked file's language, by filename then extension.
/// None means binary-adjacent or unclassifiable — it still counts toward
/// totals but lands in the "Other" bucket.
fn language_of(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    match name.as_str() {
        "dockerfile" => return Some("Dockerfile"),
        "makefile" => return Some("Makefile"),
        "cmakelists.txt" => return Some("CMake"),
        _ => {}
    }
    let ext = match name.rfind('.') {
        // dot at 0 is a dotfile like .gitignore — no extension to map
        Some(dot) if dot > 0 => &name[dot + 1..],
        _ => return None,
    };
    Some(match ext {
        "ts" | "tsx" | "mts" | "cts" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "rs" => "Rust",
        "py" => "Python",
        "rb" => "Ruby",
        "go" => "Go",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "c" | "h" => "C",
        "cpp" | "cc" | "cxx" | "hpp" => "C++",
        "cs" => "C#",
        "swift" => "Swift",
        "php" => "PHP",
        "css" => "CSS",
        "scss" => "SCSS",
        "less" => "Less",
        "html" | "htm" => "HTML",
        "xml" | "svg" => "XML",
        "json" => "JSON",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        "ini" => "INI",
        "md" | "markdown" => "Markdown",
        "sh" | "bash" | "zsh" => "Shell",
        "ps1" | "psm1" | "psd1" => "PowerShell",
        "bat" | "cmd" => "Batch",
        "sql" => "SQL",
        "graphql" | "gql" => "GraphQL",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "lua" => "Lua",
        "r" => "R",
        "dart" => "Dart",
        "ex" | "exs" => "Elixir",
        "erl" => "Erlang",
        "hs" => "Haskell",
        "scala" => "Scala",
        "pl" | "pm" => "Perl",
        "proto" => "Protocol Buffers",
        "zig" => "Zig",
        "tf" => "HCL",
        _ => return None,
    })
}

/// Tallies author names and commit dates from `git log --format=%aN%x00%cI`
/// output (newest first): contributor counts plus the first/last dates.
struct LogTally {
    commit_count: u64,
    contributor_count: u32,
    top_contributors: Vec<ContributorStat>,
    first_commit_date: Option<String>,
    last_commit_date: Option<String>,
}

fn tally_log(stdout: &str) -> LogTally {
    let mut authors: HashMap<&str, u32> = HashMap::new();
    let mut commit_count = 0u64;
    let mut last: Option<String> = None;
    let mut first: Option<String> = None;
    for line in stdout.lines() {
        let Some((author, date)) = line.split_once('\0') else {
            continue;
        };
        commit_count += 1;
        *authors.entry(author).or_default() += 1;
        if last.is_none() {
            last = Some(date.to_string());
        }
        first = Some(date.to_string());
    }
    let mut top: Vec<ContributorStat> = authors
        .iter()
        .map(|(name, commits)| ContributorStat {
            name: (*name).to_string(),
            commits: *commits,
        })
        .collect();
    top.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.name.cmp(&b.name)));
    top.truncate(5);
    LogTally {
        commit_count,
        contributor_count: authors.len() as u32,
        top_contributors: top,
        first_commit_date: first,
        last_commit_date: last,
    }
}

/// Recursive size of a directory; unreadable entries are skipped rather
/// than failing the whole scan.
fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            total += dir_size(&entry.path());
        } else {
            total += meta.len();
        }
    }
    total
}

struct TreeScan {
    tracked_files: u32,
    tracked_bytes: u64,
    total_lines: u64,
    languages: Vec<LanguageStat>,
}

/// Sizes and line-counts the tracked files, bucketing text files by language.
/// Binary files (NUL byte near the start) count toward files/bytes only.
fn scan_tree(root: &Path, files: Vec<String>) -> TreeScan {
    let mut buckets: HashMap<&'static str, LanguageStat> = HashMap::new();
    let mut other = LanguageStat {
        name: "Other".into(),
        files: 0,
        lines: 0,
        bytes: 0,
    };
    let mut tracked_files = 0u32;
    let mut tracked_bytes = 0u64;
    let mut total_lines = 0u64;
    for rel in files {
        let path = root.join(&rel);
        let Ok(meta) = std::fs::metadata(&path) else {
            // Deleted from the working tree but still tracked — skip.
            continue;
        };
        tracked_files += 1;
        tracked_bytes += meta.len();
        if meta.len() > MAX_COUNTED_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let head = &bytes[..bytes.len().min(8000)];
        if head.contains(&0) {
            continue; // binary
        }
        let mut lines = bytes.iter().filter(|b| **b == b'\n').count() as u64;
        if !bytes.is_empty() && bytes.last() != Some(&b'\n') {
            lines += 1;
        }
        total_lines += lines;
        let bucket = match language_of(&rel) {
            Some(lang) => buckets.entry(lang).or_insert_with(|| LanguageStat {
                name: lang.into(),
                files: 0,
                lines: 0,
                bytes: 0,
            }),
            None => &mut other,
        };
        bucket.files += 1;
        bucket.lines += lines;
        bucket.bytes += meta.len();
    }
    let mut languages: Vec<LanguageStat> = buckets.into_values().collect();
    if other.files > 0 {
        languages.push(other);
    }
    languages.sort_by(|a, b| b.lines.cmp(&a.lines).then(a.name.cmp(&b.name)));
    TreeScan {
        tracked_files,
        tracked_bytes,
        total_lines,
        languages,
    }
}

#[tauri::command]
pub async fn git_repo_stats(repo_path: String) -> AppResult<RepoStats> {
    // Non-zero exit means an unborn HEAD (no commits yet) — empty stats.
    let log = run_git_raw(
        Some(&repo_path),
        &["log", "--format=%aN%x00%cI"],
        STATS_TIMEOUT,
    )
    .await?;
    let tally = if log.code == 0 {
        tally_log(&log.stdout_lossy())
    } else {
        tally_log("")
    };

    let branches = run_git(
        Some(&repo_path),
        &["for-each-ref", "refs/heads", "--format=%(refname)"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let branch_count = branches.stdout_lossy().lines().count() as u32;
    let tags = run_git(Some(&repo_path), &["tag", "--list"], DEFAULT_TIMEOUT).await?;
    let tag_count = tags
        .stdout_lossy()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count() as u32;

    let git_dir = run_git(
        Some(&repo_path),
        &["rev-parse", "--absolute-git-dir"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let git_dir = PathBuf::from(git_dir.stdout_lossy().trim());
    let ls = run_git(Some(&repo_path), &["ls-files", "-z"], STATS_TIMEOUT).await?;
    let files: Vec<String> = ls
        .stdout_lossy()
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    let root = PathBuf::from(&repo_path);
    let (scan, git_dir_bytes) = tokio::task::spawn_blocking(move || {
        (scan_tree(&root, files), dir_size(&git_dir))
    })
    .await
    .map_err(|e| AppError::Io(std::io::Error::other(e)))?;

    Ok(RepoStats {
        commit_count: tally.commit_count,
        branch_count,
        tag_count,
        contributor_count: tally.contributor_count,
        top_contributors: tally.top_contributors,
        first_commit_date: tally.first_commit_date,
        last_commit_date: tally.last_commit_date,
        tracked_files: scan.tracked_files,
        tracked_bytes: scan.tracked_bytes,
        git_dir_bytes,
        total_lines: scan.total_lines,
        languages: scan.languages,
    })
}

#[tauri::command]
pub async fn git_branch_stats(
    repo_path: String,
    branch: String,
    base: String,
) -> AppResult<BranchStats> {
    for name in [&branch, &base] {
        if name.is_empty() || name.starts_with('-') {
            return Err(AppError::InvalidArgument(format!(
                "invalid branch name: {name}"
            )));
        }
    }
    let range = format!("{base}..{branch}");
    let log = run_git(
        Some(&repo_path),
        &["log", "--format=%aN%x00%cI", &range],
        STATS_TIMEOUT,
    )
    .await?;
    let tally = tally_log(&log.stdout_lossy());

    // Three-dot: changes since the merge base, i.e. what this branch adds.
    let merge_range = format!("{base}...{branch}");
    let diff = run_git(
        Some(&repo_path),
        &["diff", "--numstat", &merge_range],
        STATS_TIMEOUT,
    )
    .await?;
    let mut files_changed = 0u32;
    let mut additions = 0u64;
    let mut deletions = 0u64;
    for line in diff.stdout_lossy().lines() {
        let mut parts = line.split('\t');
        let (Some(add), Some(del)) = (parts.next(), parts.next()) else {
            continue;
        };
        files_changed += 1;
        // "-" marks binary files: counted as changed, no line totals.
        additions += add.parse::<u64>().unwrap_or(0);
        deletions += del.parse::<u64>().unwrap_or(0);
    }

    Ok(BranchStats {
        commit_count: tally.commit_count,
        contributor_count: tally.contributor_count,
        top_contributors: tally.top_contributors,
        first_commit_date: tally.first_commit_date,
        last_commit_date: tally.last_commit_date,
        files_changed,
        additions,
        deletions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_of_maps_names_and_extensions() {
        assert_eq!(language_of("src/main.rs"), Some("Rust"));
        assert_eq!(language_of("src/App.TSX"), Some("TypeScript"));
        assert_eq!(language_of("docker/Dockerfile"), Some("Dockerfile"));
        assert_eq!(language_of(".gitignore"), None);
        assert_eq!(language_of("assets/logo.png"), None);
    }

    #[test]
    fn tally_log_counts_authors_and_dates() {
        let log = "Bea\x002026-06-10T10:00:00+00:00\nAl\x002026-06-09T10:00:00+00:00\nBea\x002026-06-08T10:00:00+00:00\n";
        let t = tally_log(log);
        assert_eq!(t.commit_count, 3);
        assert_eq!(t.contributor_count, 2);
        assert_eq!(t.top_contributors[0].name, "Bea");
        assert_eq!(t.top_contributors[0].commits, 2);
        assert_eq!(t.last_commit_date.as_deref(), Some("2026-06-10T10:00:00+00:00"));
        assert_eq!(t.first_commit_date.as_deref(), Some("2026-06-08T10:00:00+00:00"));
    }
}
