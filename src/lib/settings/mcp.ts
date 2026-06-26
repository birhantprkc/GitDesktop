import type { McpKeyValue, McpServer } from "./api";

/** Server name = the key in the generated MCP config: letters/digits/`-`/`_`,
 *  must start with a letter or digit, no spaces. */
export const MCP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** A blank server for the "Add" dialog. stdio is the common default. */
export function emptyMcpServer(): McpServer {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    enabled: true,
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
