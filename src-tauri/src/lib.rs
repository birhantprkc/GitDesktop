mod error;
mod fsops;
mod git;
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
            git::status::git_status,
            git::branches::git_branches,
            git::branches::git_checkout_branch,
            git::branches::git_create_branch,
            git::diff::git_diff_file,
            git::diff::git_staged_diff,
            git::stage::git_stage,
            git::stage::git_unstage,
            git::commit::git_commit,
            git::commit::git_recent_commits,
            git::history::git_log,
            git::history::git_commit_details,
            git::history::git_commit_files,
            git::history::git_commit_file_diff,
            git::ops::git_discard,
            git::ops::git_reset,
            git::ops::git_checkout_commit,
            git::ops::git_revert,
            git::ops::git_cherry_pick,
            git::ops::git_tag,
            fsops::append_to_gitignore,
            fsops::reveal_in_explorer,
            fsops::open_with_default,
            git::remote::git_fetch,
            git::remote::git_pull,
            git::remote::git_push,
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
