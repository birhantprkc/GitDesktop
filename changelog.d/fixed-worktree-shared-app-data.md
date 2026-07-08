- Local pull requests, issues, review history, review drafts, branch rules, and
  automation rules are now keyed by repository identity rather than checkout path, so
  they're shared across all of a repo's worktrees — a PR created in one worktree now
  shows up in the main checkout, and the MCP server's local-PR tools no longer report
  "no local PRs found" when the server is bound to a worktree.
