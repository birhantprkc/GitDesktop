import type { McpKeyValue, McpServer } from "./api";

/** Server name = the key in the generated MCP config: letters/digits/`-`/`_`,
 *  must start with a letter or digit, no spaces. */
export const MCP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The sentinel scope meaning "available in every repo". */
export const MCP_SCOPE_GLOBAL = "global";

/** A server's effective scope ("global" when unset, for back-compat with
 *  registries saved before scoping existed). */
export function serverScope(server: McpServer): string {
  const s = server.scope?.trim();
  return s ? s : MCP_SCOPE_GLOBAL;
}

/** Whether a server is in SCOPE for `repoPath` (ignores per-repo on/off):
 *  global servers always are; a repo-scoped server only in its own repo. */
export function isServerInScope(
  server: McpServer,
  repoPath: string | null,
): boolean {
  const scope = serverScope(server);
  return scope === MCP_SCOPE_GLOBAL || scope === repoPath;
}

/** A server's resolved state in `repoPath`: "on" (available + default-on),
 *  "optional" (available, off by default), or "off" (not offered). A global
 *  server can be overridden per repo (`repoOverrides`); otherwise — and always
 *  for repo-scoped servers — it follows `enabled` (on / optional). */
export type McpRepoState = "on" | "optional" | "off";
export function effectiveMcpState(
  server: McpServer,
  repoPath: string | null,
): McpRepoState {
  if (repoPath && serverScope(server) === MCP_SCOPE_GLOBAL) {
    const override = server.repoOverrides?.[repoPath];
    if (override) return override;
  }
  return server.enabled ? "on" : "optional";
}

/** Whether a server is OFFERED to sessions in `repoPath` (in scope and not
 *  per-repo "off"). The composer picker + resume both use this. */
export function isServerAvailable(
  server: McpServer,
  repoPath: string | null,
): boolean {
  return (
    isServerInScope(server, repoPath) &&
    effectiveMcpState(server, repoPath) !== "off"
  );
}

/** Whether a server is pre-selected by default for a new session in `repoPath`. */
export function isServerDefaultOn(
  server: McpServer,
  repoPath: string | null,
): boolean {
  return (
    isServerAvailable(server, repoPath) &&
    effectiveMcpState(server, repoPath) === "on"
  );
}

/** Whether an (agent, isolation) combination can run MCP servers at all.
 *  Claude / Copilot / opencode: BOTH host and container — each CLI auto-approves MCP
 *  tool calls non-interactively (`--mcp-config` / `--additional-mcp-config` +
 *  `--allow-all-tools` / `OPENCODE_CONFIG` + `--dangerously-skip-permissions`), and
 *  the container delivers the same config into the CLI's mounted home. Codex: container
 *  only — host `codex exec` cancels every MCP tool call (stdin EOF → "declined", an
 *  upstream limitation), while a container session bypasses approvals so they run.
 *  Shared by the composer (gating) and the store (persist). */
export function mcpSupportedFor(agent: string, isContainer: boolean): boolean {
  if (agent === "codex") return isContainer;
  return agent === "claude" || agent === "copilot" || agent === "opencode";
}

/** Whether a specific server can run under `agent`. Codex's MCP config only takes
 *  local (stdio) servers cleanly (its remote support is bearer-token-only, not the
 *  arbitrary headers our http servers carry), so http servers aren't offered to it.
 *  Claude, Copilot, and opencode all take stdio + http. */
export function mcpServerUsableBy(server: McpServer, agent: string): boolean {
  return agent === "codex" ? server.transport === "stdio" : true;
}

/** A blank server for the "Add" dialog. stdio + global are the common defaults;
 *  the dialog's scope control narrows it to the open repo when wanted. */
export function emptyMcpServer(): McpServer {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    enabled: true,
    scope: MCP_SCOPE_GLOBAL,
    transport: "stdio",
    command: "",
    args: [],
    env: [],
    url: "",
    headers: [],
    secretKeys: [],
  };
}

/** The env (stdio) or header (http) entries for a server, by its transport. */
export function entriesFor(server: McpServer): McpKeyValue[] {
  return server.transport === "stdio" ? server.env : server.headers;
}

/** The OS-keychain "provider" string a secret env/header value is stored under.
 *  Namespaced per server id + entry key so two servers can't collide. */
export function mcpSecretRef(serverId: string, entryKey: string): string {
  return `mcp-server/${serverId}/${entryKey}`;
}

/**
 * Validate one server against the rest of the registry. Returns the first
 * problem as a human message, or null when it's valid. Drives the dialog's
 * inline error + disabled Save (we never silently drop a bad server).
 */
export function validateMcpServer(
  server: McpServer,
  others: McpServer[],
): string | null {
  const name = server.name.trim();
  if (!name) return "Give the server a name.";
  if (!MCP_NAME_RE.test(name))
    return "Name can use letters, digits, - and _ only (no spaces).";
  // Names are unique across the WHOLE registry, not per scope: the name is the
  // key in the generated config, and a session can hold global + repo-scoped
  // servers together, so two same-named servers could otherwise collide. Global
  // uniqueness keeps every generated config key unambiguous.
  if (
    others.some(
      (o) =>
        o.id !== server.id &&
        o.name.trim().toLowerCase() === name.toLowerCase(),
    )
  )
    return `Another server is already named "${name}".`;

  if (server.transport === "stdio") {
    if (!server.command.trim()) return "Enter the command to run (e.g. npx).";
  } else {
    const url = server.url.trim();
    if (!url) return "Enter the server URL.";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "Enter a valid URL (https://…).";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return "URL must be http(s).";
  }

  const entries = entriesFor(server);
  const seen = new Set<string>();
  for (const e of entries) {
    const key = e.key.trim();
    if (!key)
      return server.transport === "stdio"
        ? "An environment variable is missing its name."
        : "A header is missing its name.";
    if (seen.has(key))
      return `Duplicate ${server.transport === "stdio" ? "variable" : "header"} "${key}".`;
    seen.add(key);
  }
  return null;
}
