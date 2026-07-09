//! Saving a Research report as a LOCAL Markdown file in the working tree.
//!
//! Same scaffold-local-files posture as `.github/FUNDING.yml` (see `funding.rs`):
//! we WRITE the file into the repo and let the user review and commit it through
//! the normal flow — never committing on their behalf. Reports land in
//! `.gitdesktop/research/<slug>.md` — the app's committed metadata folder
//! (alongside `instructions.md` / `branch-rules.json`), so the file shows up in
//! the Changes tab and can be reopened, in-app, by the canvas.
//!
//! The slug derives from a model-produced report title, so it is untrusted: both
//! the directory and the file stem are sanitized here (defense-in-depth) so a
//! crafted title can never traverse out of the repo.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Normalize a relative report directory, rejecting anything that could escape
/// the repo (absolute paths, a `..` component). Empty falls back to
/// `.gitdesktop/research`.
fn safe_subdir(dir: &str) -> AppResult<PathBuf> {
    // Trim only TRAILING separators ("notes/" tolerance): a LEADING separator is
    // a root/absolute path and must survive to the RootDir rejection below —
    // trimming it would silently coerce "/etc" into repo-relative "etc".
    let trimmed = dir.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return Ok(PathBuf::from(".gitdesktop").join("research"));
    }
    let mut out = PathBuf::new();
    for comp in Path::new(trimmed).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            // A relative inside-the-repo path only ever has Normal components.
            // Reject the rest (RootDir/Prefix = absolute, ParentDir = escape).
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::InvalidArgument(format!(
                    "report directory must be a relative path inside the repo: {dir:?}"
                )));
            }
            Component::CurDir => {}
        }
    }
    if out.as_os_str().is_empty() {
        return Ok(PathBuf::from(".gitdesktop").join("research"));
    }
    Ok(out)
}

/// A safe single-segment file stem: ASCII letters/digits/underscore are kept,
/// every run of other characters collapses to a single hyphen, and leading/
/// trailing hyphens are trimmed. So a model-derived title can never introduce a
/// path separator or `..` to traverse out of the report dir, and the name stays
/// clean (no `--` from `": "`).
fn safe_slug(slug: &str) -> AppResult<String> {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in slug.trim().chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let cleaned: String = out.trim_matches('-').chars().take(80).collect();
    if cleaned.is_empty() {
        return Err(AppError::InvalidArgument("empty report name".into()));
    }
    Ok(cleaned)
}

/// Writes a research report to `<repo>/<dir>/<slug>.md` (creating the directory),
/// overwriting any existing file of that name. Returns the repo-relative path for
/// display. The user commits it like any other working-tree change — we never do.
#[tauri::command]
pub async fn research_save_report(
    repo_path: String,
    dir: String,
    slug: String,
    content: String,
) -> AppResult<String> {
    let rel = safe_subdir(&dir)?.join(format!("{}.md", safe_slug(&slug)?));
    let target = Path::new(&repo_path).join(&rel);
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(AppError::Io)?;
    }
    tokio::fs::write(&target, content)
        .await
        .map_err(AppError::Io)?;
    // Forward slashes read cleanly in the UI on every platform.
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_keeps_safe_chars_and_collapses_the_rest() {
        assert_eq!(safe_slug("LAN Companion: feasibility!").unwrap(), "LAN-Companion-feasibility");
        assert_eq!(safe_slug("already-fine_1").unwrap(), "already-fine_1");
    }

    #[test]
    fn slug_neutralizes_path_traversal() {
        // A crafted title can't become `..` or carry a separator — both collapse
        // to hyphens, so the stem is always a single safe filename segment.
        assert_eq!(safe_slug("../../etc/passwd").unwrap(), "etc-passwd");
        assert!(!safe_slug("a/b\\c").unwrap().contains(['/', '\\']));
    }

    #[test]
    fn slug_rejects_all_unsafe() {
        assert!(safe_slug("   ").is_err());
        assert!(safe_slug("///").is_err());
    }

    #[test]
    fn subdir_defaults_and_accepts_nested_relative() {
        assert_eq!(safe_subdir("").unwrap(), PathBuf::from(".gitdesktop").join("research"));
        assert_eq!(
            safe_subdir(".gitdesktop/research").unwrap(),
            PathBuf::from(".gitdesktop").join("research")
        );
        assert_eq!(safe_subdir("notes").unwrap(), PathBuf::from("notes"));
    }

    #[test]
    fn subdir_rejects_escape_and_absolute() {
        assert!(safe_subdir("../escape").unwrap_err().to_string().contains("inside the repo"));
        assert!(safe_subdir("docs/../../etc").is_err());
        #[cfg(windows)]
        assert!(safe_subdir(r"C:\Windows").is_err());
        #[cfg(not(windows))]
        assert!(safe_subdir("/etc").is_err());
    }
}
