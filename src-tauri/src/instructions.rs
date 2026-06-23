use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Per-repo AI instructions, read from `<repo>/.gitdesktop/instructions.md`.
#[tauri::command]
pub async fn read_repo_instructions(repo_path: String) -> AppResult<Option<String>> {
    let path = Path::new(&repo_path)
        .join(".gitdesktop")
        .join("instructions.md");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => {
            let trimmed = text.trim();
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Per-repo AI ignore patterns from `<repo>/.gitdesktop/aiignore`
/// (gitignore-style globs, one per line, # comments).
#[tauri::command]
pub async fn read_repo_ai_ignore(repo_path: String) -> AppResult<Vec<String>> {
    let path = Path::new(&repo_path).join(".gitdesktop").join("aiignore");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => Ok(parse_patterns(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Per-repo SHARED branch rules, read from `<repo>/.gitdesktop/branch-rules.json`.
/// Returns the raw file contents (parsed and normalized on the frontend, which
/// owns the schema), or None when the file is absent or empty.
#[tauri::command]
pub async fn read_repo_branch_rules(repo_path: String) -> AppResult<Option<String>> {
    let path = Path::new(&repo_path)
        .join(".gitdesktop")
        .join("branch-rules.json");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) if text.trim().is_empty() => Ok(None),
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Writes the repo's shared branch rules to `<repo>/.gitdesktop/branch-rules.json`,
/// creating the `.gitdesktop` directory if needed. The caller passes the
/// already-serialized (pretty-printed) JSON so the committed file is
/// diff-friendly.
#[tauri::command]
pub async fn write_repo_branch_rules(repo_path: String, contents: String) -> AppResult<()> {
    let dir = Path::new(&repo_path).join(".gitdesktop");
    tokio::fs::create_dir_all(&dir).await.map_err(AppError::Io)?;
    let path = dir.join("branch-rules.json");
    tokio::fs::write(&path, contents).await.map_err(AppError::Io)
}

/// Per-repo SHARED syntax config, read from `<repo>/.gitdesktop/syntax.json`.
/// Returns the raw file contents (parsed on the frontend, which owns the
/// schema), or None when the file is absent or empty.
#[tauri::command]
pub async fn read_repo_syntax(repo_path: String) -> AppResult<Option<String>> {
    let path = Path::new(&repo_path).join(".gitdesktop").join("syntax.json");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) if text.trim().is_empty() => Ok(None),
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Writes the repo's shared syntax config to `<repo>/.gitdesktop/syntax.json`,
/// creating `.gitdesktop` if needed. The caller passes already-serialized
/// (pretty-printed) JSON so the committed file stays diff-friendly.
#[tauri::command]
pub async fn write_repo_syntax(repo_path: String, contents: String) -> AppResult<()> {
    let dir = Path::new(&repo_path).join(".gitdesktop");
    tokio::fs::create_dir_all(&dir).await.map_err(AppError::Io)?;
    let path = dir.join("syntax.json");
    tokio::fs::write(&path, contents).await.map_err(AppError::Io)
}

pub fn parse_patterns(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(String::from)
        .collect()
}

/// One repo-local agent slash command, read from `<repo>/.claude/commands/`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCommand {
    /// Command name (the file stem), typed after `/` in the composer.
    pub name: String,
    /// Short description from frontmatter (may be empty).
    pub description: String,
    /// Prompt body; `$ARGUMENTS`/`$1..` are expanded on the frontend.
    pub prompt: String,
    /// Frontmatter `argument-hint` shown after the name (may be empty).
    pub argument_hint: String,
}

/// Repo-local agent slash commands from `<repo>/.claude/commands/*.md`
/// (Claude Code's custom-command format, reused as-is). Each file's stem is the
/// command name; an optional leading `--- … ---` block supplies `description`
/// and `argument-hint`; the rest is the prompt template. Returns an empty list
/// when the directory is absent. Nested/namespaced subfolders are not walked yet.
#[tauri::command]
pub fn read_repo_commands(repo_path: String) -> AppResult<Vec<RepoCommand>> {
    let dir = Path::new(&repo_path).join(".claude").join("commands");
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(AppError::Io(e)),
    };
    let mut paths: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("md"))
        .collect();
    paths.sort();

    let mut out = Vec::new();
    for path in paths {
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let parsed = parse_command_md(&text);
        if parsed.prompt.trim().is_empty() {
            continue;
        }
        out.push(RepoCommand {
            name: name.to_string(),
            description: parsed.description,
            prompt: parsed.prompt,
            argument_hint: parsed.argument_hint,
        });
    }
    Ok(out)
}

struct ParsedCommand {
    description: String,
    argument_hint: String,
    prompt: String,
}

/// Splits an optional Claude Code frontmatter block (a leading `--- … ---` of
/// `key: value` lines) from the prompt body. Only `description` and
/// `argument-hint` are recognized; everything else in the block is ignored.
/// Files without frontmatter are treated as a pure prompt body.
fn parse_command_md(text: &str) -> ParsedCommand {
    let trimmed = text.trim_start_matches(['\u{feff}', '\n', '\r', ' ']);
    if let Some(rest) = trimmed.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let front = &rest[..end];
            let mut description = String::new();
            let mut argument_hint = String::new();
            for line in front.lines() {
                let line = line.trim();
                if let Some(v) = line.strip_prefix("description:") {
                    description = unquote(v);
                } else if let Some(v) = line.strip_prefix("argument-hint:") {
                    argument_hint = unquote(v);
                }
            }
            // Skip the entire closing-fence LINE (whatever its dash count), so a
            // body that itself starts with `-` (a markdown list) is preserved.
            // `end` indexes the "\n" before the closing fence.
            let after_fence = &rest[end + 1..];
            let body = match after_fence.find('\n') {
                Some(nl) => after_fence[nl + 1..].trim(),
                None => "",
            };
            return ParsedCommand {
                description,
                argument_hint,
                prompt: body.to_string(),
            };
        }
    }
    ParsedCommand {
        description: String::new(),
        argument_hint: String::new(),
        prompt: text.trim().to_string(),
    }
}

/// Trims a frontmatter value and strips one layer of matching quotes.
fn unquote(value: &str) -> String {
    let v = value.trim();
    let bytes = v.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        return v[1..v.len() - 1].to_string();
    }
    v.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_and_body() {
        let md = "---\ndescription: Review the diff\nargument-hint: [focus]\n---\nReview $ARGUMENTS now.\n";
        let p = parse_command_md(md);
        assert_eq!(p.description, "Review the diff");
        assert_eq!(p.argument_hint, "[focus]");
        assert_eq!(p.prompt, "Review $ARGUMENTS now.");
    }

    #[test]
    fn strips_quotes_from_values() {
        let md = "---\ndescription: \"Quoted desc\"\nargument-hint: '[x]'\n---\nBody\n";
        let p = parse_command_md(md);
        assert_eq!(p.description, "Quoted desc");
        assert_eq!(p.argument_hint, "[x]");
        assert_eq!(p.prompt, "Body");
    }

    #[test]
    fn body_only_without_frontmatter() {
        let p = parse_command_md("Just a prompt body.\n");
        assert_eq!(p.description, "");
        assert_eq!(p.argument_hint, "");
        assert_eq!(p.prompt, "Just a prompt body.");
    }

    #[test]
    fn ignores_unknown_frontmatter_keys() {
        let md = "---\nmodel: opus\ndescription: D\n---\nBody";
        let p = parse_command_md(md);
        assert_eq!(p.description, "D");
        assert_eq!(p.prompt, "Body");
    }

    #[test]
    fn preserves_body_starting_with_dash() {
        let md = "---\ndescription: D\n---\n- first\n- second\n";
        let p = parse_command_md(md);
        assert_eq!(p.description, "D");
        assert_eq!(p.prompt, "- first\n- second");
    }
}
