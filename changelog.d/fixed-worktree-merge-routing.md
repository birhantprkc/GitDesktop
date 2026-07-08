- Merging a local pull request into a base branch that's checked out in another worktree
  now fast-forwards that worktree instead of refusing, keeping its working tree in sync
  (and failing with a clear message if that worktree has uncommitted changes).
