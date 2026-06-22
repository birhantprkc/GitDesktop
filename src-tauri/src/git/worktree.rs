//! Throwaway `git worktree`s for agent sessions. Every write-capable agent run
//! happens inside one of these — an isolated branch checkout in a directory
//! *outside* the repo, so the user's working tree, index, and current branch are
//! never touched no matter what the agent does. See `docs/agent-sessions.md`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::git::runner::{run_git, run_git_mutating, DEFAULT_TIMEOUT};
use crate::state::AppState;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    /// The short session id (also the worktree's directory name).
    pub id: String,
    /// Absolute path to the worktree checkout.
    pub path: String,
    /// The session branch (`gd/session/<id>`), or empty if detached.
    pub branch: String,
    /// The commit the worktree was created from — the base for a session's
    /// cumulative `base..HEAD` diff. Resolved by `create`; empty from `list`.
    pub base: String,
}

/// A short, stable hash of the repo path, used to namespace a repo's session
/// worktrees. Lower-cased first since Windows paths are case-insensitive.
fn repo_hash(repo_path: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    repo_path.to_lowercase().hash(&mut h);
    format!("{:016x}", h.finish())
}

/// A reasonably unique session id: process id + the low bits of the current
/// time. Collisions are astronomically unlikely at human session-creation pace,
/// and `git worktree add -b` fails loudly on a duplicate branch regardless.
fn new_session_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    format!("{:x}{:x}", std::process::id(), nanos & 0xffff_ffff_ffff)
}

/// The per-repo session-worktree root: `<app_data>/worktrees/<repo-hash>`.
fn worktree_root(app: &AppHandle, repo_path: &str) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
        .join("worktrees")
        .join(repo_hash(repo_path));
    Ok(dir)
}

/// Creates a throwaway worktree off `base_ref` (default HEAD) on a fresh
/// `gd/session/<id>` branch, under the app-data worktree root. Returns the new
/// worktree's id/path/branch.
#[tauri::command]
pub async fn git_worktree_create(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_path: String,
    base_ref: Option<String>,
) -> AppResult<WorktreeInfo> {
    let id = new_session_id();
    let branch = format!("gd/session/{id}");
    let root = worktree_root(&app, &repo_path)?;
    std::fs::create_dir_all(&root)?;
    let path = root.join(&id);
    let path_str = path.to_string_lossy().into_owned();
    let base = base_ref
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("HEAD");
    run_git_mutating(
        &state,
        &repo_path,
        &["worktree", "add", "-b", &branch, &path_str, base],
        DEFAULT_TIMEOUT,
    )
    .await?;
    // The fresh worktree's HEAD is exactly the base commit (no turns yet); record
    // it so the session diff can show the cumulative `base..HEAD` across turns.
    let head = run_git(Some(&path_str), &["rev-parse", "HEAD"], DEFAULT_TIMEOUT).await?;
    Ok(WorktreeInfo {
        id,
        path: path_str,
        branch,
        base: head.stdout_lossy().trim().to_string(),
    })
}

/// Lists the repo's worktrees (main checkout included). Used to discover orphaned
/// session worktrees left by a crash so they can be cleaned up.
#[tauri::command]
pub async fn git_worktree_list(repo_path: String) -> AppResult<Vec<WorktreeInfo>> {
    let out = run_git(
        Some(&repo_path),
        &["worktree", "list", "--porcelain"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(parse_worktree_list(&out.stdout_lossy()))
}

/// Removes a session worktree and (when given) deletes its branch. `force` is
/// needed to drop a worktree with uncommitted changes — i.e. a discarded
/// session whose output was never committed.
#[tauri::command]
pub async fn git_worktree_remove(
    state: State<'_, AppState>,
    repo_path: String,
    path: String,
    branch: Option<String>,
    force: bool,
) -> AppResult<()> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&path);
    run_git_mutating(&state, &repo_path, &args, DEFAULT_TIMEOUT).await?;
    // The branch can only be deleted once it's no longer checked out (i.e. after
    // the worktree is gone). Best-effort: a failure here shouldn't fail removal.
    if let Some(branch) = branch.as_deref().filter(|b| !b.is_empty()) {
        let _ = run_git_mutating(
            &state,
            &repo_path,
            &["branch", "-D", branch],
            DEFAULT_TIMEOUT,
        )
        .await;
    }
    Ok(())
}

/// Prunes stale worktree admin entries (a worktree whose directory was deleted
/// out from under git, e.g. by an app crash). Safe to run on startup.
#[tauri::command]
pub async fn git_worktree_prune(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    run_git_mutating(&state, &repo_path, &["worktree", "prune"], DEFAULT_TIMEOUT).await?;
    Ok(())
}

/// Stages everything (including untracked files) in a worktree and commits it,
/// so an agent session's output becomes a clean, reviewable commit on its
/// branch. Returns the new commit hash, or `None` when the agent changed
/// nothing (no commit made).
#[tauri::command]
pub async fn git_worktree_commit_all(
    state: State<'_, AppState>,
    worktree_path: String,
    message: String,
) -> AppResult<Option<String>> {
    let status = run_git(
        Some(&worktree_path),
        &["status", "--porcelain"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    if status.stdout_lossy().trim().is_empty() {
        return Ok(None);
    }
    run_git_mutating(&state, &worktree_path, &["add", "-A"], DEFAULT_TIMEOUT).await?;
    run_git_mutating(
        &state,
        &worktree_path,
        &["commit", "-m", &message],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let head = run_git(
        Some(&worktree_path),
        &["rev-parse", "HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(Some(head.stdout_lossy().trim().to_string()))
}

/// Collapses all of a session branch's per-turn commits since `base` into one
/// commit with `message` (soft-reset to base, then re-commit the combined
/// tree). Returns `false` when HEAD is already at `base` (nothing to squash).
/// Used by "Keep" to turn the turn-by-turn checkpoints into a clean single
/// commit before the branch becomes a PR.
#[tauri::command]
pub async fn git_worktree_squash(
    state: State<'_, AppState>,
    worktree_path: String,
    base: String,
    message: String,
) -> AppResult<bool> {
    let head = run_git(
        Some(&worktree_path),
        &["rev-parse", "HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    if head.stdout_lossy().trim() == base.trim() {
        return Ok(false);
    }
    run_git_mutating(
        &state,
        &worktree_path,
        &["reset", "--soft", &base],
        DEFAULT_TIMEOUT,
    )
    .await?;
    run_git_mutating(
        &state,
        &worktree_path,
        &["commit", "-m", &message],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(true)
}

/// Re-creates a worktree for a previously *kept* session, checking out its
/// EXISTING branch (not a fresh `-b` one) at `path`, so the user can resume work
/// where they left off. Prunes first in case a stale admin entry lingers from
/// the worktree's prior removal. The branch must not be checked out elsewhere
/// (Keep removes the worktree before this is ever called), and `base` is
/// unchanged on the frontend so the cumulative `base..HEAD` diff still spans all
/// turns.
#[tauri::command]
pub async fn git_worktree_resume(
    state: State<'_, AppState>,
    repo_path: String,
    path: String,
    branch: String,
) -> AppResult<()> {
    let _ = run_git_mutating(&state, &repo_path, &["worktree", "prune"], DEFAULT_TIMEOUT).await;
    run_git_mutating(
        &state,
        &repo_path,
        &["worktree", "add", &path, &branch],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Parses `git worktree list --porcelain` into one `WorktreeInfo` per stanza.
/// Stanzas are blank-line separated; each carries a `worktree <path>` line and
/// (unless detached) a `branch refs/heads/<name>` line.
fn parse_worktree_list(porcelain: &str) -> Vec<WorktreeInfo> {
    let mut out = Vec::new();
    let mut path: Option<String> = None;
    let mut branch = String::new();
    let flush = |path: &mut Option<String>, branch: &mut String, out: &mut Vec<WorktreeInfo>| {
        if let Some(p) = path.take() {
            let id = std::path::Path::new(&p)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            out.push(WorktreeInfo {
                id,
                path: p,
                branch: std::mem::take(branch),
                base: String::new(),
            });
        }
    };
    for line in porcelain.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            // A new stanza starts; emit the previous one first.
            flush(&mut path, &mut branch, &mut out);
            path = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
        }
    }
    flush(&mut path, &mut branch, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_hash_is_stable_and_case_insensitive() {
        assert_eq!(repo_hash("C:/Repos/App"), repo_hash("c:/repos/app"));
        assert_ne!(repo_hash("C:/Repos/App"), repo_hash("C:/Repos/Other"));
    }

    #[test]
    fn parse_worktree_list_reads_path_and_branch() {
        let porcelain = "\
worktree C:/repos/app
HEAD 462b9fc1bb9cebaf69593c294ff5d4f2f3769af7
branch refs/heads/master

worktree C:/data/worktrees/abc/sess1
HEAD 462b9fc1bb9cebaf69593c294ff5d4f2f3769af7
branch refs/heads/gd/session/sess1
";
        let got = parse_worktree_list(porcelain);
        assert_eq!(
            got,
            vec![
                WorktreeInfo {
                    id: "app".into(),
                    path: "C:/repos/app".into(),
                    branch: "master".into(),
                    base: String::new(),
                },
                WorktreeInfo {
                    id: "sess1".into(),
                    path: "C:/data/worktrees/abc/sess1".into(),
                    branch: "gd/session/sess1".into(),
                    base: String::new(),
                },
            ]
        );
    }

    #[test]
    fn parse_worktree_list_handles_detached_head() {
        // A detached worktree has no `branch` line.
        let porcelain = "worktree C:/repos/app\nHEAD 462b9fc\ndetached\n";
        let got = parse_worktree_list(porcelain);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].branch, "");
        assert_eq!(got[0].id, "app");
    }

    async fn run(repo: &str, args: &[&str]) -> String {
        run_git(Some(repo), args, DEFAULT_TIMEOUT)
            .await
            .unwrap()
            .stdout_lossy()
    }

    /// Real-repo lifecycle: add a session worktree, see it in the parsed list,
    /// remove + prune + delete its branch. Requires git on PATH (true for dev).
    #[tokio::test]
    async fn worktree_add_list_remove_roundtrip() {
        let base = std::env::temp_dir().join(format!(
            "gd-wt-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let repo = base.join("repo");
        let wt = base.join("wt");
        std::fs::create_dir_all(&repo).unwrap();
        let repo_s = repo.to_string_lossy().into_owned();
        let wt_s = wt.to_string_lossy().into_owned();

        run(&repo_s, &["init", "-q"]).await;
        run(&repo_s, &["config", "user.email", "t@t.local"]).await;
        run(&repo_s, &["config", "user.name", "T"]).await;
        std::fs::write(repo.join("a.txt"), "hello\n").unwrap();
        run(&repo_s, &["add", "-A"]).await;
        run(&repo_s, &["commit", "-qm", "seed"]).await;

        run(
            &repo_s,
            &["worktree", "add", "-b", "gd/session/test", &wt_s, "HEAD"],
        )
        .await;
        assert!(wt.join("a.txt").exists(), "worktree checkout has the file");

        let list = parse_worktree_list(&run(&repo_s, &["worktree", "list", "--porcelain"]).await);
        let sess = list
            .iter()
            .find(|w| w.branch == "gd/session/test")
            .expect("session worktree is listed");
        assert_eq!(sess.id, "wt");

        run(&repo_s, &["worktree", "remove", "--force", &wt_s]).await;
        run(&repo_s, &["worktree", "prune"]).await;
        run(&repo_s, &["branch", "-D", "gd/session/test"]).await;
        let after = parse_worktree_list(&run(&repo_s, &["worktree", "list", "--porcelain"]).await);
        assert!(
            after.iter().all(|w| w.branch != "gd/session/test"),
            "session worktree is gone after remove"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    /// Keep (remove worktree, retain branch) then Resume (re-add the worktree on
    /// the SAME existing branch at the SAME path) — the resumed checkout has the
    /// kept work and the branch is back in the worktree list.
    #[tokio::test]
    async fn worktree_keep_then_resume_reattaches_branch() {
        let base = std::env::temp_dir().join(format!(
            "gd-wt-resume-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let repo = base.join("repo");
        let wt = base.join("wt");
        std::fs::create_dir_all(&repo).unwrap();
        let repo_s = repo.to_string_lossy().into_owned();
        let wt_s = wt.to_string_lossy().into_owned();

        run(&repo_s, &["init", "-q"]).await;
        run(&repo_s, &["config", "user.email", "t@t.local"]).await;
        run(&repo_s, &["config", "user.name", "T"]).await;
        std::fs::write(repo.join("a.txt"), "hello\n").unwrap();
        run(&repo_s, &["add", "-A"]).await;
        run(&repo_s, &["commit", "-qm", "seed"]).await;

        // Session: worktree on a fresh branch, makes a commit (the "kept" work).
        run(
            &repo_s,
            &["worktree", "add", "-b", "gd/session/keep", &wt_s, "HEAD"],
        )
        .await;
        std::fs::write(wt.join("b.txt"), "work\n").unwrap();
        run(&wt_s, &["add", "-A"]).await;
        run(&wt_s, &["commit", "-qm", "agent work"]).await;

        // Keep: drop the worktree dir, retain the branch. No --force, matching
        // production (per-turn commits leave the worktree clean).
        run(&repo_s, &["worktree", "remove", &wt_s]).await;
        assert!(!wt.exists(), "worktree dir gone after keep");

        // Resume: re-add a worktree on the EXISTING branch at the same path.
        run(&repo_s, &["worktree", "prune"]).await;
        run(&repo_s, &["worktree", "add", &wt_s, "gd/session/keep"]).await;
        assert!(
            wt.join("b.txt").exists(),
            "resumed worktree has the kept work"
        );
        let list = parse_worktree_list(&run(&repo_s, &["worktree", "list", "--porcelain"]).await);
        assert!(
            list.iter().any(|w| w.branch == "gd/session/keep"),
            "branch is checked out in a worktree again after resume"
        );

        let _ = std::fs::remove_dir_all(&base);
    }
}
