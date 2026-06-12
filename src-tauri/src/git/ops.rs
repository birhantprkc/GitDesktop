use std::path::Path;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::git::history::validate_hash;
use crate::git::runner::{run_git, run_git_mutating, DEFAULT_TIMEOUT};
use crate::git::types::{FileDiff, RepoOpState, StashEntry};
use crate::state::AppState;

/// Whether a file/dir inside .git exists (worktree-safe via --git-path).
async fn git_path_exists(repo: &str, name: &str) -> bool {
    let Ok(out) = run_git(
        Some(repo),
        &["rev-parse", "--git-path", name],
        DEFAULT_TIMEOUT,
    )
    .await
    else {
        return false;
    };
    let raw = out.stdout_lossy();
    let path = Path::new(raw.trim());
    if path.is_absolute() {
        path.exists()
    } else {
        Path::new(repo).join(path).exists()
    }
}

/// Which multi-step git operation, if any, is mid-flight — drives the
/// conflict-resolution banner.
#[tauri::command]
pub async fn git_op_state(repo_path: String) -> AppResult<RepoOpState> {
    Ok(RepoOpState {
        merging: git_path_exists(&repo_path, "MERGE_HEAD").await,
        rebasing: git_path_exists(&repo_path, "rebase-merge").await
            || git_path_exists(&repo_path, "rebase-apply").await,
        cherry_picking: git_path_exists(&repo_path, "CHERRY_PICK_HEAD").await,
    })
}

fn validate_op(op: &str) -> AppResult<()> {
    match op {
        "merge" | "rebase" | "cherry-pick" => Ok(()),
        _ => Err(AppError::InvalidArgument(format!("unknown operation: {op}"))),
    }
}

/// Abandons an in-progress merge/rebase/cherry-pick, restoring the
/// pre-operation state.
#[tauri::command]
pub async fn git_op_abort(
    state: State<'_, AppState>,
    repo_path: String,
    op: String,
) -> AppResult<()> {
    validate_op(&op)?;
    run_git_mutating(
        &state,
        &repo_path,
        &[op.as_str(), "--abort"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Finishes an in-progress operation once every conflict is resolved and
/// staged. A merge concludes with its commit; rebase/cherry-pick continue
/// with `core.editor=true` so git never tries to open an editor.
#[tauri::command]
pub async fn git_op_continue(
    state: State<'_, AppState>,
    repo_path: String,
    op: String,
) -> AppResult<()> {
    validate_op(&op)?;
    let args: Vec<&str> = match op.as_str() {
        "merge" => vec!["commit", "--no-edit"],
        other => vec!["-c", "core.editor=true", other, "--continue"],
    };
    run_git_mutating(&state, &repo_path, &args, DEFAULT_TIMEOUT).await?;
    Ok(())
}

/// Discards working-tree changes for one file. Tracked files are restored
/// from the index; untracked files go to the OS recycle bin.
#[tauri::command]
pub async fn git_discard(
    state: State<'_, AppState>,
    repo_path: String,
    path: String,
    untracked: bool,
) -> AppResult<()> {
    if untracked {
        let full = Path::new(&repo_path).join(&path);
        tauri::async_runtime::spawn_blocking(move || {
            trash::delete(&full).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
        })
        .await
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))??;
        return Ok(());
    }
    run_git_mutating(&state, &repo_path, &["restore", "--", &path], DEFAULT_TIMEOUT).await?;
    Ok(())
}

/// Mixed reset: moves the branch pointer, keeps the working tree.
#[tauri::command]
pub async fn git_reset(
    state: State<'_, AppState>,
    repo_path: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    run_git_mutating(&state, &repo_path, &["reset", "--mixed", &hash], DEFAULT_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_checkout_commit(
    state: State<'_, AppState>,
    repo_path: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    run_git_mutating(&state, &repo_path, &["switch", "--detach", &hash], DEFAULT_TIMEOUT)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn git_revert(
    state: State<'_, AppState>,
    repo_path: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    // -m is not supported here; reverting merge commits needs a parent choice
    run_git_mutating(&state, &repo_path, &["revert", "--no-edit", &hash], DEFAULT_TIMEOUT)
        .await?;
    Ok(())
}

/// Returns true when a commit was created. Cherry-picking changes that are
/// already present makes git stop with an in-progress empty pick; that's not
/// an error worth surfacing raw — clean up with --skip and report false.
#[tauri::command]
pub async fn git_cherry_pick(
    state: State<'_, AppState>,
    repo_path: String,
    hash: String,
) -> AppResult<bool> {
    validate_hash(&hash)?;
    match run_git_mutating(&state, &repo_path, &["cherry-pick", &hash], DEFAULT_TIMEOUT).await {
        Ok(_) => Ok(true),
        Err(AppError::Git { stderr, .. })
            if stderr.contains("is now empty") || stderr.contains("--allow-empty") =>
        {
            let _ = run_git_mutating(
                &state,
                &repo_path,
                &["cherry-pick", "--skip"],
                DEFAULT_TIMEOUT,
            )
            .await;
            Ok(false)
        }
        Err(e) => Err(e),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CherryPickRangeResult {
    pub applied: usize,
    pub skipped: usize,
}

/// Copies the given commits (oldest-first) onto `target_branch`, then leaves
/// you on that branch. Commits whose changes already exist there are skipped
/// rather than erroring. If any commit conflicts, the whole operation is
/// rolled back — the target branch is reset to its prior tip and you return to
/// where you started — so the repo is never left mid-conflict.
#[tauri::command]
pub async fn git_cherry_pick_onto(
    state: State<'_, AppState>,
    repo_path: String,
    hashes: Vec<String>,
    target_branch: String,
) -> AppResult<CherryPickRangeResult> {
    use crate::git::runner::run_git;

    validate_branch_arg(&target_branch)?;
    for h in &hashes {
        validate_hash(h)?;
    }
    if hashes.is_empty() {
        return Ok(CherryPickRangeResult {
            applied: 0,
            skipped: 0,
        });
    }

    // Where we are now, so we can return on failure. A detached HEAD has no
    // branch name, so fall back to restoring its commit directly.
    let original_ref = run_git(
        Some(&repo_path),
        &["rev-parse", "--abbrev-ref", "HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?
    .stdout_lossy()
    .trim()
    .to_string();
    let detached = original_ref == "HEAD";
    let original_restore = if detached {
        run_git(Some(&repo_path), &["rev-parse", "HEAD"], DEFAULT_TIMEOUT)
            .await?
            .stdout_lossy()
            .trim()
            .to_string()
    } else {
        original_ref
    };

    // The target's tip before we touch it, so we can roll back cleanly.
    let target_tip = run_git(
        Some(&repo_path),
        &["rev-parse", &target_branch],
        DEFAULT_TIMEOUT,
    )
    .await?
    .stdout_lossy()
    .trim()
    .to_string();

    run_git_mutating(&state, &repo_path, &["switch", &target_branch], DEFAULT_TIMEOUT).await?;

    let mut applied = 0usize;
    let mut skipped = 0usize;
    for hash in &hashes {
        match run_git_mutating(&state, &repo_path, &["cherry-pick", hash], DEFAULT_TIMEOUT).await {
            Ok(_) => applied += 1,
            Err(AppError::Git { stderr, .. })
                if stderr.contains("is now empty") || stderr.contains("--allow-empty") =>
            {
                let _ = run_git_mutating(
                    &state,
                    &repo_path,
                    &["cherry-pick", "--skip"],
                    DEFAULT_TIMEOUT,
                )
                .await;
                skipped += 1;
            }
            Err(AppError::Git { code, stderr }) => {
                // Roll everything back: abort the in-progress pick, drop the
                // commits already applied in this batch, and return home.
                let _ = run_git_mutating(
                    &state,
                    &repo_path,
                    &["cherry-pick", "--abort"],
                    DEFAULT_TIMEOUT,
                )
                .await;
                let _ = run_git_mutating(
                    &state,
                    &repo_path,
                    &["reset", "--hard", &target_tip],
                    DEFAULT_TIMEOUT,
                )
                .await;
                let restore_args: Vec<&str> = if detached {
                    vec!["switch", "--detach", &original_restore]
                } else {
                    vec!["switch", &original_restore]
                };
                let _ = run_git_mutating(&state, &repo_path, &restore_args, DEFAULT_TIMEOUT).await;
                let short = &hash[..hash.len().min(7)];
                return Err(AppError::Git {
                    code,
                    stderr: format!(
                        "Cherry-pick hit conflicts on {short} and was rolled back; {target_branch} is unchanged.\n{stderr}"
                    ),
                });
            }
            Err(e) => return Err(e),
        }
    }

    Ok(CherryPickRangeResult { applied, skipped })
}

/// Discards every uncommitted change: untracked files go to the recycle bin,
/// tracked changes are hard-reset to HEAD.
#[tauri::command]
pub async fn git_discard_all(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    use crate::git::runner::{run_git, run_git_raw};

    let status_out = run_git(
        Some(&repo_path),
        &[
            "status",
            "--porcelain=v2",
            "--untracked-files=all",
            "-z",
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let status = crate::git::status::parse_status_v2(&status_out.stdout_lossy());
    let untracked: Vec<String> = status
        .entries
        .iter()
        .filter(|e| e.unstaged == Some(crate::git::types::ChangeKind::Untracked))
        .map(|e| e.path.clone())
        .collect();

    if !untracked.is_empty() {
        let repo = repo_path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for path in untracked {
                let full = Path::new(&repo).join(&path);
                trash::delete(&full)
                    .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
            }
            Ok::<(), AppError>(())
        })
        .await
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))??;
    }

    let head_exists = run_git_raw(
        Some(&repo_path),
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?
    .code
        == 0;
    if head_exists {
        run_git_mutating(&state, &repo_path, &["reset", "--hard", "HEAD"], DEFAULT_TIMEOUT)
            .await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_stash_all(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    run_git_mutating(
        &state,
        &repo_path,
        &["stash", "push", "--include-untracked"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_pop(state: State<'_, AppState>, repo_path: String) -> AppResult<()> {
    run_git_mutating(&state, &repo_path, &["stash", "pop"], DEFAULT_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_count(repo_path: String) -> AppResult<u32> {
    let out = crate::git::runner::run_git(
        Some(&repo_path),
        &["stash", "list", "--format=%H"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(out.stdout_lossy().lines().count() as u32)
}

#[tauri::command]
pub async fn git_stash_list(repo_path: String) -> AppResult<Vec<StashEntry>> {
    let out = run_git(
        Some(&repo_path),
        &["stash", "list", "--format=%gd%x00%s%x00%cI"],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let text = out.stdout_lossy();
    let entries = text
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\0');
            let (Some(refname), Some(message), Some(date)) =
                (parts.next(), parts.next(), parts.next())
            else {
                return None;
            };
            // %gd is "stash@{N}" — the N is the index every other stash
            // command addresses.
            let index: u32 = refname
                .strip_prefix("stash@{")?
                .strip_suffix('}')?
                .parse()
                .ok()?;
            Some(StashEntry {
                index,
                message: message.to_string(),
                date: date.to_string(),
            })
        })
        .collect();
    Ok(entries)
}

/// The combined diff a stash would re-apply, for previewing it.
#[tauri::command]
pub async fn git_stash_show(repo_path: String, index: u32) -> AppResult<FileDiff> {
    let spec = format!("stash@{{{index}}}");
    let out = run_git(
        Some(&repo_path),
        &[
            "stash",
            "show",
            "-p",
            "--include-untracked",
            "--no-color",
            &spec,
        ],
        DEFAULT_TIMEOUT,
    )
    .await?;
    let text = out.stdout_lossy();
    let is_binary = text
        .lines()
        .any(|l| l.starts_with("Binary files ") && l.ends_with(" differ"));
    let (text, is_truncated) =
        crate::git::diff::truncate_at_char_boundary(text, 1_000_000);
    Ok(FileDiff {
        file_path: spec,
        is_binary,
        is_truncated,
        text,
    })
}

#[tauri::command]
pub async fn git_stash_apply(
    state: State<'_, AppState>,
    repo_path: String,
    index: u32,
    pop: bool,
) -> AppResult<()> {
    let spec = format!("stash@{{{index}}}");
    let sub = if pop { "pop" } else { "apply" };
    run_git_mutating(&state, &repo_path, &["stash", sub, &spec], DEFAULT_TIMEOUT).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_stash_drop(
    state: State<'_, AppState>,
    repo_path: String,
    index: u32,
) -> AppResult<()> {
    let spec = format!("stash@{{{index}}}");
    run_git_mutating(
        &state,
        &repo_path,
        &["stash", "drop", &spec],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}

fn validate_branch_arg(name: &str) -> AppResult<()> {
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::InvalidArgument(format!(
            "invalid branch name: {name}"
        )));
    }
    Ok(())
}

/// Merges a branch into the current one. With `squash`, the combined changes
/// are left staged so the user writes the commit themselves. Conflicts leave
/// the repo in a normal merge-conflict state visible in the changes list.
#[tauri::command]
pub async fn git_merge(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    squash: bool,
) -> AppResult<()> {
    validate_branch_arg(&branch)?;
    let args: Vec<&str> = if squash {
        vec!["merge", "--squash", &branch]
    } else {
        vec!["merge", "--no-edit", &branch]
    };
    run_git_mutating(&state, &repo_path, &args, DEFAULT_TIMEOUT).await?;
    Ok(())
}

/// Rebases the current branch onto another. Conflicts leave the rebase in
/// progress — the changes panel's conflict banner takes it from there
/// (continue or abort).
#[tauri::command]
pub async fn git_rebase(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
) -> AppResult<()> {
    validate_branch_arg(&branch)?;
    run_git_mutating(
        &state,
        &repo_path,
        &["-c", "core.editor=true", "rebase", &branch],
        DEFAULT_TIMEOUT,
    )
    .await?;
    Ok(())
}

/// Merges `head` into `base` for a local PR using one of three strategies,
/// matching GitHub's merge options:
/// - "merge"  → a `--no-ff` merge commit carrying `message`
/// - "squash" → squash all of head's commits into one commit with `message`
/// - "rebase" → replay head's commits onto base (cherry-pick range, no merge
///   commit), preserving their individual messages
///
/// Checks out `base` first and leaves you there on success. Any failure
/// (conflict, etc.) is rolled back: base is reset to its prior tip and your
/// original branch restored, so nothing is left half-merged.
#[tauri::command]
pub async fn git_merge_local_pr(
    state: State<'_, AppState>,
    repo_path: String,
    base: String,
    head: String,
    message: String,
    strategy: String,
) -> AppResult<()> {
    use crate::git::runner::run_git;

    validate_branch_arg(&base)?;
    validate_branch_arg(&head)?;
    let message = if message.trim().is_empty() {
        format!("Merge {head} into {base}")
    } else {
        message
    };

    // Remember where we are + base's tip so any failure can be undone.
    let original = run_git(
        Some(&repo_path),
        &["rev-parse", "--abbrev-ref", "HEAD"],
        DEFAULT_TIMEOUT,
    )
    .await?
    .stdout_lossy()
    .trim()
    .to_string();
    let detached = original == "HEAD";
    let original_restore = if detached {
        run_git(Some(&repo_path), &["rev-parse", "HEAD"], DEFAULT_TIMEOUT)
            .await?
            .stdout_lossy()
            .trim()
            .to_string()
    } else {
        original
    };
    let base_tip = run_git(Some(&repo_path), &["rev-parse", &base], DEFAULT_TIMEOUT)
        .await?
        .stdout_lossy()
        .trim()
        .to_string();

    run_git_mutating(&state, &repo_path, &["switch", &base], DEFAULT_TIMEOUT).await?;

    let range = format!("{base}..{head}");
    let result: AppResult<()> = match strategy.as_str() {
        "squash" => {
            match run_git_mutating(
                &state,
                &repo_path,
                &["merge", "--squash", &head],
                DEFAULT_TIMEOUT,
            )
            .await
            {
                Ok(_) => run_git_mutating(
                    &state,
                    &repo_path,
                    &["commit", "-m", &message],
                    DEFAULT_TIMEOUT,
                )
                .await
                .map(|_| ()),
                Err(e) => Err(e),
            }
        }
        "rebase" => run_git_mutating(&state, &repo_path, &["cherry-pick", &range], DEFAULT_TIMEOUT)
            .await
            .map(|_| ()),
        _ => run_git_mutating(
            &state,
            &repo_path,
            &["merge", "--no-ff", "-m", &message, &head],
            DEFAULT_TIMEOUT,
        )
        .await
        .map(|_| ()),
    };

    match result {
        Ok(()) => Ok(()),
        Err(err) => {
            // Roll back any half-applied state, then return home. The aborts
            // are best-effort (only one applies); the hard reset is the
            // guarantee that base is left exactly as it was.
            let _ = run_git_mutating(&state, &repo_path, &["merge", "--abort"], DEFAULT_TIMEOUT).await;
            let _ = run_git_mutating(
                &state,
                &repo_path,
                &["cherry-pick", "--abort"],
                DEFAULT_TIMEOUT,
            )
            .await;
            let _ = run_git_mutating(
                &state,
                &repo_path,
                &["reset", "--hard", &base_tip],
                DEFAULT_TIMEOUT,
            )
            .await;
            let restore: Vec<&str> = if detached {
                vec!["switch", "--detach", &original_restore]
            } else {
                vec!["switch", &original_restore]
            };
            let _ = run_git_mutating(&state, &repo_path, &restore, DEFAULT_TIMEOUT).await;
            match err {
                AppError::Git { code, stderr } => Err(AppError::Git {
                    code,
                    stderr: format!(
                        "{strategy} merge hit conflicts and was rolled back; {base} is unchanged.\n{stderr}"
                    ),
                }),
                other => Err(other),
            }
        }
    }
}

#[tauri::command]
pub async fn git_tag(
    state: State<'_, AppState>,
    repo_path: String,
    name: String,
    hash: String,
) -> AppResult<()> {
    validate_hash(&hash)?;
    if name.is_empty() || name.starts_with('-') {
        return Err(AppError::InvalidArgument(format!("invalid tag name: {name}")));
    }
    run_git_mutating(&state, &repo_path, &["tag", "--", &name, &hash], DEFAULT_TIMEOUT).await?;
    Ok(())
}
