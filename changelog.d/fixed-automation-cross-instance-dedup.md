- Automations no longer fire twice when two app instances (for example a main
  checkout and a linked worktree) watch the same repository — a run is now claimed
  atomically across processes before any AI work, so only one instance posts the
  review.
