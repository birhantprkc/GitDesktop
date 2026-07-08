- **MCP: PR/issue text is flagged as untrusted to connected agents.** The built-in MCP
  server's read tools that return third-party prose — `list_pull_requests`,
  `get_pull_request`, `list_pull_request_comments`, `list_issues`, and `get_issue` — now
  prepend a note marking the titles, bodies, and comments as data to analyze, never as
  instructions to follow, so an agent pulling a PR's comments in is less exposed to prompt
  injection from an attacker-authored comment. Defense-in-depth: forge writes remain gated
  behind `--allow-remote-write`.
