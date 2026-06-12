use tauri::State;

use crate::error::{AppError, AppResult};
use crate::git::runner::{run_git, run_git_mutating_input, run_git_raw, DEFAULT_TIMEOUT};
use crate::git::types::{DiffStatEntry, FileDiff, StagedDiff};
use crate::state::AppState;

/// Cap on file bytes shipped for image previews.
const IMAGE_MAX_BYTES: usize = 20_000_000;

/// Raw file bytes (base64) at a revision, or from the working tree when
/// `rev` is None. `None` result = the file doesn't exist there (e.g. the
/// old side of an added file). Drives the image diff view.
#[tauri::command]
pub async fn git_file_base64(
    repo_path: String,
    rev: Option<String>,
    file_path: String,
) -> AppResult<Option<String>> {
    use base64::Engine;
    let bytes: Option<Vec<u8>> = match rev {
        Some(rev) => {
            if rev.is_empty() || rev.starts_with('-') {
                return Err(AppError::InvalidArgument(format!("invalid rev: {rev}")));
            }
            let spec = format!("{rev}:{file_path}");
            let out = run_git_raw(Some(&repo_path), &["show", &spec], DEFAULT_TIMEOUT).await?;
            // Nonzero exit = the path doesn't exist at that revision.
            (out.code == 0).then_some(out.stdout)
        }
        None => tokio::fs::read(std::path::Path::new(&repo_path).join(&file_path))
            .await
            .ok(),
    };
    if let Some(b) = &bytes {
        if b.len() > IMAGE_MAX_BYTES {
            return Err(AppError::InvalidArgument(
                "file too large to preview".into(),
            ));
        }
    }
    Ok(bytes.map(|b| base64::engine::general_purpose::STANDARD.encode(b)))
}

/// Applies a patch — typically a single hunk cut out of a working-tree diff.
/// stage hunk = `cached`, unstage hunk = `cached + reverse`,
/// discard hunk = `reverse` (working tree).
#[tauri::command]
pub async fn git_apply_patch(
    state: State<'_, AppState>,
    repo_path: String,
    patch: String,
    cached: bool,
    reverse: bool,
) -> AppResult<()> {
    if patch.trim().is_empty() {
        return Err(AppError::InvalidArgument("empty patch".into()));
    }
    let mut args = vec!["apply", "--whitespace=nowarn"];
    if cached {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    args.push("-"); // read the patch from stdin
    run_git_mutating_input(&state, &repo_path, &args, Some(&patch), DEFAULT_TIMEOUT).await?;
    Ok(())
}

/// Cap on diff text shipped to the webview for rendering.
const VIEWER_MAX_BYTES: usize = 1_000_000;
/// Default cap on staged diff text shipped for AI prompt building.
const AI_DEFAULT_MAX_BYTES: usize = 1_000_000;

#[tauri::command]
pub async fn git_diff_file(
    repo_path: String,
    file_path: String,
    staged: bool,
    untracked: bool,
) -> AppResult<FileDiff> {
    let out = if untracked {
        // Full-file "added" diff for files git doesn't track yet.
        // git maps /dev/null to the platform null device; exit code 1 just
        // means "differences found" for --no-index.
        let out = run_git_raw(
            Some(&repo_path),
            &["diff", "--no-index", "--", "/dev/null", &file_path],
            DEFAULT_TIMEOUT,
        )
        .await?;
        if out.code > 1 {
            return Err(AppError::Git {
                code: out.code,
                stderr: out.stderr,
            });
        }
        out
    } else {
        let mut args = vec!["diff", "--no-color"];
        if staged {
            args.push("--cached");
        }
        args.extend(["--", file_path.as_str()]);
        run_git(Some(&repo_path), &args, DEFAULT_TIMEOUT).await?
    };

    let text = out.stdout_lossy();
    let is_binary = text.lines().any(|l| {
        l.starts_with("Binary files ") && l.ends_with(" differ")
    });
    let (text, is_truncated) = truncate_at_char_boundary(text, VIEWER_MAX_BYTES);

    Ok(FileDiff {
        file_path,
        is_binary,
        is_truncated,
        text,
    })
}

#[tauri::command]
pub async fn git_staged_diff(
    repo_path: String,
    max_bytes: Option<usize>,
    exclude: Option<Vec<String>>,
) -> AppResult<StagedDiff> {
    let max_bytes = max_bytes.unwrap_or(AI_DEFAULT_MAX_BYTES);

    // Translate ignore patterns into git pathspec excludes so matching has
    // exact gitignore-style glob semantics. ":(exclude)" needs at least one
    // inclusive pathspec alongside it, hence the leading ".".
    let mut pathspec: Vec<String> = Vec::new();
    for pattern in exclude.unwrap_or_default() {
        let pattern = pattern.trim();
        if pattern.is_empty() || pattern.starts_with('#') {
            continue;
        }
        pathspec.push(format!(":(exclude){pattern}"));
    }

    let mut diff_args: Vec<&str> = vec!["diff", "--cached", "--no-color"];
    let mut stat_args: Vec<&str> = vec!["diff", "--cached", "--numstat", "-z"];
    if !pathspec.is_empty() {
        for args in [&mut diff_args, &mut stat_args] {
            args.push("--");
            args.push(".");
            args.extend(pathspec.iter().map(String::as_str));
        }
    }

    let (diff_out, stat_out) = tokio::try_join!(
        run_git(Some(&repo_path), &diff_args, DEFAULT_TIMEOUT),
        run_git(Some(&repo_path), &stat_args, DEFAULT_TIMEOUT)
    )?;

    let files = parse_numstat_z(&stat_out.stdout_lossy());

    // Tell the caller how many changed files the excludes hid, so the AI
    // prompt can mention that the diff is not the whole story.
    let excluded_files = if pathspec.is_empty() {
        0
    } else {
        let all = run_git(
            Some(&repo_path),
            &["diff", "--cached", "--numstat", "-z"],
            DEFAULT_TIMEOUT,
        )
        .await?;
        let total = parse_numstat_z(&all.stdout_lossy()).len();
        total.saturating_sub(files.len()) as u32
    };

    let (text, truncated) = truncate_at_file_boundary(diff_out.stdout_lossy(), max_bytes);

    Ok(StagedDiff {
        text,
        truncated,
        files,
        excluded_files,
    })
}

pub fn truncate_at_char_boundary(text: String, max: usize) -> (String, bool) {
    if text.len() <= max {
        return (text, false);
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_string(), true)
}

/// Truncates a multi-file diff at a `diff --git` boundary so no file is cut
/// mid-hunk; falls back to a char-boundary cut for a single oversized file.
fn truncate_at_file_boundary(text: String, max: usize) -> (String, bool) {
    if text.len() <= max {
        return (text, false);
    }
    let mut kept_end = 0;
    let mut search_from = 0;
    loop {
        let next = if search_from == 0 && text.starts_with("diff --git ") {
            Some(0)
        } else {
            text[search_from..]
                .find("\ndiff --git ")
                .map(|i| search_from + i + 1)
        };
        match next {
            Some(start) if start <= max => {
                kept_end = start;
                search_from = start + 1;
            }
            _ => break,
        }
    }
    // kept_end is the start of the first file section that crosses the budget;
    // keep everything before it. If even the first file is too big, hard-cut.
    if kept_end == 0 {
        return truncate_at_char_boundary(text, max);
    }
    (text[..kept_end].trim_end().to_string(), true)
}

/// Parses `git diff --numstat -z` output.
/// Regular entry: `added\tdeleted\tpath\0`.
/// Rename entry:  `added\tdeleted\t\0oldpath\0newpath\0`.
/// Binary files report `-` for both counts.
pub fn parse_numstat_z(text: &str) -> Vec<DiffStatEntry> {
    let mut entries = Vec::new();
    let mut tokens = text.split('\0').peekable();
    while let Some(token) = tokens.next() {
        if token.is_empty() {
            continue;
        }
        let mut fields = token.splitn(3, '\t');
        let (Some(added), Some(deleted), Some(path)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let is_binary = added == "-";
        let added = added.parse().unwrap_or(0);
        let deleted = deleted.parse().unwrap_or(0);
        let path = if path.is_empty() {
            // rename: skip old path, take new path
            tokens.next();
            match tokens.next() {
                Some(new_path) if !new_path.is_empty() => new_path.to_string(),
                _ => continue,
            }
        } else {
            path.to_string()
        };
        entries.push(DiffStatEntry {
            path,
            added,
            deleted,
            is_binary,
        });
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_numstat_with_rename_and_binary() {
        let text = "3\t1\tapp.js\0-\t-\tbinary.bin\x000\t0\t\0util.js\0helpers.js\0";
        let entries = parse_numstat_z(text);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path, "app.js");
        assert_eq!(entries[0].added, 3);
        assert_eq!(entries[0].deleted, 1);
        assert!(entries[1].is_binary);
        assert_eq!(entries[1].path, "binary.bin");
        assert_eq!(entries[2].path, "helpers.js");
    }

    #[test]
    fn truncates_multi_file_diff_at_file_boundary() {
        let file_a = format!("diff --git a/a b/a\n{}\n", "+a\n".repeat(10));
        let file_b = format!("diff --git a/b b/b\n{}\n", "+b\n".repeat(10));
        let text = format!("{file_a}{file_b}");
        let (out, truncated) = truncate_at_file_boundary(text, file_a.len() + 5);
        assert!(truncated);
        assert!(out.starts_with("diff --git a/a"));
        assert!(!out.contains("diff --git a/b"));
    }

    #[test]
    fn small_diff_not_truncated() {
        let (out, truncated) = truncate_at_file_boundary("diff --git a/a b/a\n+x\n".into(), 1000);
        assert!(!truncated);
        assert!(out.contains("+x"));
    }

    /// End-to-end check of the hunk-staging plumbing: a single hunk cut out
    /// of a two-hunk diff stages via stdin `git apply --cached` and unstages
    /// via `--reverse`. Requires git on PATH (true for this project's dev
    /// environment).
    #[tokio::test]
    async fn apply_patch_stages_and_unstages_a_single_hunk() {
        use crate::git::runner::run_git_input;

        let dir = std::env::temp_dir().join(format!(
            "gd-apply-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().into_owned();
        let git = |args: Vec<&'static str>| {
            let repo = repo.clone();
            async move { run_git(Some(&repo), &args, DEFAULT_TIMEOUT).await.unwrap() }
        };

        git(vec!["init"]).await;
        git(vec!["config", "user.email", "t@t"]).await;
        git(vec!["config", "user.name", "t"]).await;
        // Two edit sites far enough apart (> 6 context lines) to force
        // two separate hunks.
        let base: Vec<String> = (1..=30).map(|i| format!("line {i}")).collect();
        let file = dir.join("file.txt");
        std::fs::write(&file, base.join("\n") + "\n").unwrap();
        git(vec!["add", "."]).await;
        git(vec!["commit", "-m", "base"]).await;
        let mut edited = base.clone();
        edited[2] = "line 3 EDITED".into();
        edited[24] = "line 25 EDITED".into();
        std::fs::write(&file, edited.join("\n") + "\n").unwrap();

        let diff = git(vec!["diff", "--no-color"]).await.stdout_lossy();
        let first_hunk_at = diff.find("\n@@").unwrap() + 1;
        let second_hunk_at = diff[first_hunk_at..].find("\n@@").unwrap() + first_hunk_at + 1;
        let patch = format!("{}{}", &diff[..first_hunk_at], &diff[first_hunk_at..second_hunk_at]);

        // Stage only the first hunk.
        run_git_input(
            Some(&repo),
            &["apply", "--whitespace=nowarn", "--cached", "-"],
            Some(&patch),
            DEFAULT_TIMEOUT,
        )
        .await
        .unwrap();
        let staged = git(vec!["diff", "--cached", "--no-color"]).await.stdout_lossy();
        let unstaged = git(vec!["diff", "--no-color"]).await.stdout_lossy();
        assert!(staged.contains("line 3 EDITED"));
        assert!(!staged.contains("line 25 EDITED"));
        assert!(unstaged.contains("line 25 EDITED"));

        // Unstage it again.
        run_git_input(
            Some(&repo),
            &["apply", "--whitespace=nowarn", "--cached", "--reverse", "-"],
            Some(&patch),
            DEFAULT_TIMEOUT,
        )
        .await
        .unwrap();
        let staged = git(vec!["diff", "--cached", "--no-color"]).await.stdout_lossy();
        assert!(staged.trim().is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
