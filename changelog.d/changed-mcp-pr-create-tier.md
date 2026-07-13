- **MCP `create_pull_request` now requires `--allow-git-write` in addition to
  `--allow-remote-write`.** Opening a pull request pushes the head branch to origin first — a
  local-git write — so it now correctly demands the git-write tier as well, honoring the
  rule that enabling one capability tier never grants another.
