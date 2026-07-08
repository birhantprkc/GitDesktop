- **Kept session worktrees no longer leak their folder on Windows.** When a worktree
  couldn't be removed because git's own recursive delete tripped over reparse-point
  links (how `node_modules` is laid out on Windows), the folder was left behind on disk.
  Removal now finishes the job itself once it confirms the worktree has no uncommitted
  work — a worktree with real unsaved changes is still preserved and surfaced, never
  silently discarded.
