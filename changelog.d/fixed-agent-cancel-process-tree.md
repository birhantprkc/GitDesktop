- Stopping or timing out an agent session now terminates the CLI's entire
  process tree, so helper processes (language workers, MCP servers, tool
  subprocesses) can no longer keep running in the background — previously on
  Windows only the top-level CLI was killed, leaving its children consuming
  tokens and holding worktree file handles.
