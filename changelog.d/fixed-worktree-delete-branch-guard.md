- Deleting a branch that's checked out in another worktree now explains which worktree
  holds it instead of failing with a raw git error, and the branch-cleanup dialog leaves
  such branches out of its delete list (they can still be archived).
