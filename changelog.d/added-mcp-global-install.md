- **One-click global MCP install (Claude Code / Copilot).** *Use GitDesktop as an MCP
  server* (Settings → MCP servers) can now install `gitdesktop` into a client's **global
  user config** — available in every project, no per-repo `.mcp.json` — alongside the
  existing project `.mcp.json` write. **Claude Code** and **Copilot** each get a one-click
  button that runs the client's own CLI (`claude mcp add-json … -s user` /
  `copilot mcp add …`), using a project-aware `--repo` so the single global entry follows
  whatever repo the client opens. The read-only/local-write/remote-write toggles carry over,
  and an existing entry is replaced only after you confirm.
