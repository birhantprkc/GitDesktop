- **Installing the MCP server globally now finds `claude` / `copilot` reliably.** The
  global install resolves the client CLI the same way the rest of the app does — checking
  the system PATH, known install locations, and (on Windows) the live registry PATH — so
  it no longer reports the CLI as "not found" when it lives in a directory that was added
  to PATH after GitDesktop started.
