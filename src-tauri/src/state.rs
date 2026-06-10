use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};

use crate::git::types::GitInfo;

#[derive(Default)]
pub struct AppState {
    repo_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    pub git_info: OnceCell<GitInfo>,
}

impl AppState {
    /// Per-repo lock serializing mutating git operations so concurrent
    /// invocations don't fight over .git/index.lock.
    pub async fn repo_lock(&self, repo_path: &str) -> Arc<Mutex<()>> {
        let mut map = self.repo_locks.lock().await;
        map.entry(PathBuf::from(repo_path))
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}
