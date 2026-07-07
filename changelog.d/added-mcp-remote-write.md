- **Cross-forge PR/issue/CI tools for GitDesktop's MCP server.** When run *as* an MCP
  server, GitDesktop's pull-request, issue, and CI tools now work across GitHub,
  GitLab, and Bitbucket — routed through the forge abstraction, they dispatch by the
  repo's remote (Bitbucket covers PRs and pipelines; Bitbucket issues come later via
  Jira). And a new set of **remote-write** tools can create and comment on issues,
  close/reopen them, and comment on pull requests, gated behind a separate
  `--allow-remote-write` flag. These make real writes to the repo's forge under your
  authenticated identity (GitHub `gh`, GitLab `glab`, or a stored Bitbucket token), and
  are kept distinct from the local-PR `--allow-write` tools: enabling one never grants
  the other, and read-only remains the default. PR comments an agent posts carry a
  **Posted by GitDesktop** attribution footer, and a read tool returns a pull request's
  full comment set — the conversation, review summaries, and file:line review threads —
  so an agent can read a review before replying to it.
