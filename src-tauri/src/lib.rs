mod error;
mod fsops;
mod git;
mod github;
mod instructions;
mod secrets;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            git::repo::check_git_installed,
            git::repo::validate_repo,
            git::repo::clone_repo,
            git::repo::create_repo,
            git::repo::git_repo_owners,
            git::status::git_status,
            git::branches::git_branches,
            git::branches::git_checkout_branch,
            git::branches::git_create_branch,
            git::branches::git_rename_branch,
            git::branches::git_delete_branch,
            git::branches::git_default_branch,
            git::diff::git_diff_file,
            git::diff::git_staged_diff,
            git::stage::git_stage,
            git::stage::git_unstage,
            git::commit::git_commit,
            git::commit::git_commit_authors,
            git::commit::git_user_identity,
            git::commit::git_undo_commit,
            git::commit::git_recent_commits,
            git::history::git_log,
            git::history::git_commit_details,
            git::history::git_commit_files,
            git::history::git_commit_file_diff,
            git::history::git_commit_diff,
            git::ops::git_discard,
            git::ops::git_reset,
            git::ops::git_checkout_commit,
            git::ops::git_revert,
            git::ops::git_cherry_pick,
            git::ops::git_cherry_pick_onto,
            git::ops::git_tag,
            git::ops::git_discard_all,
            git::ops::git_stash_all,
            git::ops::git_stash_pop,
            git::ops::git_stash_count,
            git::ops::git_merge,
            git::ops::git_rebase,
            git::ops::git_merge_local_pr,
            git::compare::git_compare_branches,
            git::compare::git_branch_diff_files,
            git::compare::git_branch_file_diff,
            git::compare::git_branch_diff,
            github::pr::gh_status,
            github::pr::gh_pr_create,
            github::pr::gh_repo_url,
            github::pr::gh_publish_repo,
            github::pr::gh_prs_for_branch,
            github::pr::gh_pr_list,
            github::pr::gh_pr_view,
            github::pr::gh_pr_diff,
            github::pr::gh_pr_review,
            github::pr::gh_pr_comment,
            github::pr::gh_pr_merge,
            github::pr::gh_pr_close,
            github::pr::gh_pr_ready,
            github::pr::gh_pr_edit,
            github::pr::gh_repo_labels,
            github::pr::gh_pr_edit_labels,
            fsops::append_to_gitignore,
            fsops::reveal_in_explorer,
            fsops::open_with_default,
            fsops::open_in_terminal,
            fsops::open_with_program,
            fsops::detect_editors,
            fsops::detect_terminals,
            git::remote::git_fetch,
            git::remote::git_pull,
            git::remote::git_push,
            git::remote::git_remotes,
            secrets::set_secret,
            secrets::get_secret,
            secrets::delete_secret,
            secrets::secret_exists,
            instructions::read_repo_instructions,
            instructions::read_repo_ai_ignore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
