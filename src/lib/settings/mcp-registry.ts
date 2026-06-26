import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@/lib/tauri/invoke";
import type { McpKeyValue, McpServer } from "./api";
import { MCP_SCOPE_GLOBAL } from "./mcp";
import { normalizeMcpName, SECRET_KEY_RE } from "./mcp-import";

/**
 * Client + mapping for the official MCP registry (registry.modelcontextprotocol.io),
 * powering the Settings → MCP servers "Browse" dialog. We read the public catalog
 * over Tauri HTTP (the host is allow-listed in `capabilities/default.json`) and
 * convert a chosen entry into a ready-to-add {@link McpServer} that lands
 * **disabled** — the user reviews what it runs, fills any secret, and enables it.
 * Nothing is fetched-and-run automatically; this is discovery, not execution.
 */

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

/** One positional/named argument in a package's runtime/package argument list. */
interface RegistryArgument {
  type?: "positional" | "named";
  name?: string;
  value?: string;
  default?: string;
}

/** An env var (package) or header (remote) the server declares it needs. */
interface RegistryEnvVar {
  name: string;
  description?: string;
  isSecret?: boolean;
  isRequired?: boolean;
  default?: string;
}

/** A runnable package (stdio): how to fetch + launch the server locally. */
interface RegistryPackage {
  registryType?: string; // "npm" | "pypi" | "oci" | "nuget" | …
  identifier?: string;
  version?: string;
  runtimeHint?: string; // "npx" | "uvx" | "docker" | …
  transport?: { type?: string };
  runtimeArguments?: RegistryArgument[];
  packageArguments?: RegistryArgument[];
  environmentVariables?: RegistryEnvVar[];
}

/** A hosted endpoint (http): connect to a server someone else runs. */
interface RegistryRemote {
  type?: string; // "streamable-http" | "sse"
  url?: string;
  headers?: RegistryEnvVar[];
}

/** The source repository (usually GitHub), used for the link + social stats. */
interface RegistryRepository {
  url?: string;
  source?: string; // "github" | …
  subfolder?: string;
}

/** The `server` object inside a registry entry (subset we consume). */
export interface RegistryServer {
  name: string; // reverse-DNS, e.g. "io.github.owner/name"
  title?: string;
  description?: string;
  version?: string;
  repository?: RegistryRepository;
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
}

/** The registry's own metadata block on each entry (status + timestamps). */
interface RegistryMeta {
  status?: string; // "active" | "deprecated" | "deleted"
  publishedAt?: string;
  updatedAt?: string;
}

const META_KEY = "io.modelcontextprotocol.registry/official";

interface RegistryResponse {
  servers?: {
    server: RegistryServer;
    _meta?: Record<string, RegistryMeta>;
  }[];
  metadata?: { nextCursor?: string; count?: number };
}

/** A registry entry mapped to something addable, with display + setup hints. */
export interface RegistryCandidate {
  /** Ready-to-add server (disabled, global scope, fresh id). */
  server: McpServer;
  /** Full reverse-DNS registry name — the stable de-dupe / "added" key. */
  registryName: string;
  /** Human title when the entry has one, else the short config-safe name. */
  title: string;
  /** A required or secret value still needs filling before the server will run. */
  needsSetup: boolean;
  /** Source repo (GitHub only) for the link + social stats; null when none. */
  repo: { owner: string; name: string; url: string } | null;
  /** npm package id when the chosen package is npm, for weekly installs; else null. */
  npmPackage: string | null;
  /** Registry lifecycle status — "active" (normal), "deprecated", etc. */
  status: string;
  /** When the entry was published / last updated in the registry (ISO), if known. */
  publishedAt: string | null;
  updatedAt: string | null;
}

/** A page of mapped candidates plus the cursor for the next page (if any). */
export interface RegistryPage {
  candidates: RegistryCandidate[];
  nextCursor: string | null;
}

/** Search (or list, when `search` is blank) the registry's latest servers. */
export async function searchRegistry(opts: {
  search?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<RegistryPage> {
  const params = new URLSearchParams({ version: "latest" });
  const search = opts.search?.trim();
  if (search) params.set("search", search);
  if (opts.cursor) params.set("cursor", opts.cursor);
  params.set("limit", String(opts.limit ?? 30));

  const res = await tauriFetch(`${REGISTRY_URL}?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`The MCP registry returned ${res.status}.`);
  const data = (await res.json()) as RegistryResponse;

  const candidates: RegistryCandidate[] = [];
  for (const entry of data.servers ?? []) {
    const c = toRegistryCandidate(entry.server, entry._meta?.[META_KEY]);
    if (c) candidates.push(c);
  }
  return { candidates, nextCursor: data.metadata?.nextCursor ?? null };
}

/** The launcher for a package: its declared hint, else a sensible per-ecosystem
 *  default. Left to the user to adjust for anything exotic (it lands disabled). */
function runtimeCommand(pkg: RegistryPackage): string {
  const hint = pkg.runtimeHint?.trim();
  if (hint) return hint;
  switch (pkg.registryType) {
    case "npm":
      return "npx";
    case "pypi":
      return "uvx";
    case "oci":
      return "docker";
    case "nuget":
      return "dnx";
    default:
      return pkg.identifier ?? "";
  }
}

/** Flatten one declared argument to argv tokens (named → `--flag value`). */
function renderArg(a: RegistryArgument): string[] {
  const val = (a.value ?? a.default ?? "").trim();
  if (a.type === "named" && a.name) return val ? [a.name, val] : [a.name];
  return val ? [val] : [];
}

/** The package reference token (npm pins `name@version`; others use the bare id). */
function packageRef(pkg: RegistryPackage): string {
  const id = pkg.identifier?.trim() ?? "";
  if (!id) return "";
  return pkg.registryType === "npm" && pkg.version
    ? `${id}@${pkg.version}`
    : id;
}

/** Best-effort argv: runtime args, then the package ref, then package args. */
function buildStdioArgs(pkg: RegistryPackage): string[] {
  const args: string[] = [];
  for (const a of pkg.runtimeArguments ?? []) args.push(...renderArg(a));
  const ref = packageRef(pkg);
  if (ref) args.push(ref);
  for (const a of pkg.packageArguments ?? []) args.push(...renderArg(a));
  return args;
}

/** Map declared env vars / headers to entries + the secret names among them.
 *  A var is secret if the registry flags it OR its name looks secret; secret
 *  values land empty (filled later, into the keychain). `needsValue` is true
 *  when something required/secret is still blank. */
function buildEntries(vars: RegistryEnvVar[] | undefined): {
  entries: McpKeyValue[];
  secretKeys: string[];
  needsValue: boolean;
} {
  const entries: McpKeyValue[] = [];
  const secretKeys: string[] = [];
  let needsValue = false;
  for (const v of vars ?? []) {
    const key = v.name?.trim();
    if (!key) continue;
    const secret = v.isSecret === true || SECRET_KEY_RE.test(key);
    const value = secret ? "" : (v.default ?? "");
    entries.push({ key, value });
    if (secret) secretKeys.push(key);
    if ((v.isRequired || secret) && !value) needsValue = true;
  }
  return { entries, secretKeys, needsValue };
}

/** A config-safe name from the registry name's last segment
 *  (e.g. "io.github.owner/server-name" → "server-name"). */
function shortName(registryName: string): string {
  const base = registryName.split("/").pop() ?? registryName;
  return normalizeMcpName(base);
}

/** Owner/name from a GitHub repository link, or null for non-GitHub / unparseable. */
function parseGithubRepo(
  repository: RegistryRepository | undefined,
): { owner: string; name: string; url: string } | null {
  const url = repository?.url?.trim();
  if (!url) return null;
  const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  const name = m[2].replace(/\.git$/i, "");
  if (!m[1] || !name) return null;
  return { owner: m[1], name, url };
}

/**
 * Convert a registry `server` into an addable candidate, or null when there's
 * nothing we can run (no package and no remote). Prefers a local **stdio**
 * package (private + the canonical MCP experience); falls back to the first
 * **remote** endpoint. The result always lands disabled.
 */
export function toRegistryCandidate(
  s: RegistryServer | undefined,
  meta?: RegistryMeta,
): RegistryCandidate | null {
  if (!s?.name) return null;
  const name = shortName(s.name);
  const base = {
    id: crypto.randomUUID(),
    name,
    description: s.description ?? "",
    enabled: false,
    scope: MCP_SCOPE_GLOBAL,
  };

  const pkg =
    (s.packages ?? []).find(
      (p) => !p.transport || p.transport.type === "stdio",
    ) ?? s.packages?.[0];

  let server: McpServer;
  let needsSetup: boolean;
  let npmPackage: string | null = null;
  if (pkg?.identifier) {
    const { entries, secretKeys, needsValue } = buildEntries(
      pkg.environmentVariables,
    );
    server = {
      ...base,
      transport: "stdio",
      command: runtimeCommand(pkg),
      args: buildStdioArgs(pkg),
      env: entries,
      url: "",
      headers: [],
      secretKeys,
    };
    needsSetup = needsValue;
    if (pkg.registryType === "npm") npmPackage = pkg.identifier;
  } else {
    const remote = (s.remotes ?? []).find((r) => r.url) ?? s.remotes?.[0];
    if (!remote?.url) return null;
    const { entries, secretKeys, needsValue } = buildEntries(remote.headers);
    server = {
      ...base,
      transport: "http",
      command: "",
      args: [],
      env: [],
      url: remote.url,
      headers: entries,
      secretKeys,
    };
    needsSetup = needsValue;
  }

  return {
    server,
    registryName: s.name,
    title: s.title?.trim() || name,
    needsSetup,
    repo: parseGithubRepo(s.repository),
    npmPackage,
    status: meta?.status?.trim() || "active",
    publishedAt: meta?.publishedAt ?? null,
    updatedAt: meta?.updatedAt ?? null,
  };
}

/** A registry name unique against `taken` (lowercased), suffixing `-2`, `-3`, …
 *  Server names are the keys in the generated config, so they must not collide. */
export function uniqueServerName(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

// ── Validation signals (GitHub social stats + npm installs) ───────────────────

/** GitHub social stats for one repo (from the batched `gh_repo_stats` command). */
export interface RepoStat {
  /** Canonical "owner/name" — match case-insensitively against a candidate's repo. */
  nameWithOwner: string;
  stars: number;
  forks: number;
  pushedAt: string | null;
  archived: boolean;
  license: string | null;
}

/** Batched GitHub stars/activity for "owner/name" refs, via one `gh` GraphQL
 *  call (reuses the user's gh auth). Unresolved repos are simply omitted. */
export const ghRepoStats = (repos: string[]) =>
  invoke<RepoStat[]>("gh_repo_stats", { repos });

/** Stable lowercased key for matching a candidate's repo to a {@link RepoStat}. */
export function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase();
}

/** Weekly npm downloads for one package (an "installs" proxy), or null when
 *  unknown. Best-effort: scoped names work as-is; failures degrade to null. */
export async function npmWeeklyDownloads(pkg: string): Promise<number | null> {
  try {
    const res = await tauriFetch(
      `https://api.npmjs.org/downloads/point/last-week/${pkg}`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { downloads?: number };
    return typeof data.downloads === "number" ? data.downloads : null;
  } catch {
    return null;
  }
}

/** Weekly downloads for many packages at once → `{ pkg: count }` (misses omitted). */
export async function npmWeeklyDownloadsBatch(
  pkgs: string[],
): Promise<Record<string, number>> {
  const unique = [...new Set(pkgs)];
  const results = await Promise.all(
    unique.map(async (p) => [p, await npmWeeklyDownloads(p)] as const),
  );
  const out: Record<string, number> = {};
  for (const [p, n] of results) if (n != null) out[p] = n;
  return out;
}
