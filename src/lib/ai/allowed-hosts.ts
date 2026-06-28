/**
 * Network-host allowlist for AI inference.
 *
 * The app reaches the built-in provider hosts and localhost freely. Any OTHER
 * host — a LAN / self-hosted Ollama or an OpenAI-compatible server — must be on
 * the user's allow list before the shared AI `fetch` wrapper (providers.ts) will
 * send to it. The Tauri HTTP capability is opened to `http(s)://*` as a coarse
 * backstop, so THIS list is the effective gate; keeping it small and explicit is
 * the security control the user manages in Settings → AI.
 *
 * Pure + dependency-free so it can be reasoned about (and node-smoke-tested) on
 * its own.
 */

/** Hosts the built-in providers use — always allowed, independent of the user
 *  list. Keep in sync with `providers.ts` and the capability backstop. */
export const BUILTIN_AI_HOSTS: ReadonlySet<string> = new Set([
  "api.anthropic.com",
  "api.openai.com",
  "openrouter.ai",
  "ollama.com",
  "ai-gateway.vercel.sh",
  "generativelanguage.googleapis.com",
  "api.deepseek.com",
  "api.mistral.ai",
  "api.z.ai",
]);

/** Loopback / any-local hosts — always allowed (a local Ollama is the default
 *  setup). `new URL` reports IPv6 hosts in bracketed form, so `[::1]` matches. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
]);

/** Parse a `host[:port]` entry or a full URL into a `URL` we can read the host
 *  and port off of. A bare host is given an `http://` scheme so `new URL`
 *  accepts it. Returns null when there's nothing parseable. */
function toUrl(hostOrUrl: string): URL | null {
  const s = hostOrUrl.trim();
  if (!s) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
  } catch {
    return null;
  }
}

/**
 * Canonicalize a user-entered `host[:port]` (or a pasted URL) to `host` or
 * `host:port` — lowercase host, scheme / path / default port dropped. Returns
 * null when there's no parseable host, which the caller treats as invalid input
 * (so we never store a junk entry that can never match).
 */
export function normalizeHost(raw: string): string | null {
  const u = toUrl(raw);
  if (!u || !u.hostname) return null;
  const host = u.hostname.toLowerCase();
  return u.port ? `${host}:${u.port}` : host;
}

/** True for a built-in provider host or a loopback host — allowed without
 *  consulting the user list, so the fetch wrapper can skip reading settings for
 *  these (the overwhelmingly common case). */
export function isBuiltinOrLocalHost(url: string): boolean {
  const u = toUrl(url);
  if (!u || !u.hostname) return false;
  const host = u.hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || BUILTIN_AI_HOSTS.has(host);
}

/**
 * Does a single allow-list `entry` permit this request `url`? Pure host+port
 * match, with NO built-in/local short-circuit — exposed so the UI can tell which
 * entry is keeping a configured URL reachable (an "in use" hint). A list entry
 * WITHOUT a port matches any port on that host; one WITH a port must match the
 * request's effective port (a `URL.port` of "" is resolved to the scheme default,
 * so an entry that spells out "host:443" still matches an https request).
 */
export function entryMatchesUrl(entry: string, url: string): boolean {
  const u = toUrl(url);
  const a = toUrl(entry);
  if (!u || !u.hostname || !a || !a.hostname) return false;
  if (a.hostname.toLowerCase() !== u.hostname.toLowerCase()) return false;
  const reqEffectivePort = u.port || (u.protocol === "https:" ? "443" : "80");
  return a.port === "" || a.port === reqEffectivePort;
}

/**
 * Is a request to `url` permitted given the user's allow list? Allowed when the
 * host is built-in / local, or matches a list entry (see {@link entryMatchesUrl}).
 * An unparseable URL is blocked (fail-closed).
 */
export function isHostAllowed(
  url: string,
  allowed: readonly string[],
): boolean {
  if (isBuiltinOrLocalHost(url)) return true;
  return allowed.some((entry) => entryMatchesUrl(entry, url));
}

/** The `host[:port]` label of a URL, for an error message or a display chip.
 *  Falls back to the raw string if it won't parse. */
export function hostLabel(url: string): string {
  return normalizeHost(url) ?? url;
}
