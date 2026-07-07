- **One-click "add `gitdesktop` to PATH."** *Use GitDesktop as an MCP server* (Settings →
  MCP servers) now has a **Command-line launcher** with an **Add to PATH** button, so the
  bare `gitdesktop mcp …` command resolves in any terminal without a hardcoded path or
  `GITDESKTOP_BIN`. It appends the app to your user PATH on Windows (no admin — open a new
  terminal afterward) or symlinks `gitdesktop` into `~/.local/bin` on macOS/Linux, shows
  whether it's already on your PATH, and **Remove** reverses exactly what it added.
