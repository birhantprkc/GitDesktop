use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify, OnceCell};

use crate::git::types::GitInfo;

pub struct AppState {
    repo_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    pub git_info: OnceCell<GitInfo>,
    /// In-flight agent-CLI reviews keyed by a frontend-supplied id, so a
    /// separate cancel command can signal the streaming run to stop.
    agent_cancels: Mutex<HashMap<String, Arc<Notify>>>,
    /// Whether closing the window hides the app to the tray (keeping it running)
    /// instead of quitting. Mirrors the user's setting, pushed from the frontend;
    /// defaults to true so the first close behaves correctly before that sync.
    close_to_tray: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            repo_locks: Mutex::new(HashMap::new()),
            git_info: OnceCell::new(),
            agent_cancels: Mutex::new(HashMap::new()),
            close_to_tray: AtomicBool::new(true),
        }
    }
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

    /// Registers a cancellation handle for a review id and returns it. The
    /// caller awaits `notified()` and must call `clear_agent_cancel` when done.
    pub async fn register_agent_cancel(&self, id: &str) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        self.agent_cancels
            .lock()
            .await
            .insert(id.to_string(), notify.clone());
        notify
    }

    pub async fn clear_agent_cancel(&self, id: &str) {
        self.agent_cancels.lock().await.remove(id);
    }

    /// Signals an in-flight review to cancel. No-op if the id is unknown.
    pub async fn cancel_agent(&self, id: &str) {
        if let Some(notify) = self.agent_cancels.lock().await.get(id) {
            notify.notify_waiters();
        }
    }

    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }

    pub fn set_close_to_tray(&self, enabled: bool) {
        self.close_to_tray.store(enabled, Ordering::Relaxed);
    }
}
