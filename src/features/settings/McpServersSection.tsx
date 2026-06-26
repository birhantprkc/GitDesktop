import {
  DownloadSimpleIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PencilSimpleIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { withForm } from "@/lib/form";
import { deleteMcpSecret, setMcpSecret } from "@/lib/git/api";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import type { McpServer } from "@/lib/settings/api";
import {
  effectiveMcpState,
  emptyMcpServer,
  entriesFor,
  MCP_SCOPE_GLOBAL,
  type McpRepoState,
  serverScope,
  validateMcpServer,
} from "@/lib/settings/mcp";
import {
  discoverMcpServers,
  type ImportCandidate,
  toImportCandidate,
} from "@/lib/settings/mcp-import";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { settingsFormOpts } from "./settings-form";

/** One editable env-var (stdio) / header (http) row in the dialog. Kept with a
 *  stable local `rowId` so renaming a key doesn't reorder or lose focus, and a
 *  separate `secretInput` for a newly-typed secret (the saved value is never
 *  read back out of the keychain). */
interface EntryRow {
  rowId: string;
  key: string;
  value: string;
  secret: boolean;
  secretInput: string;
}

/** Last path segment of a repo root, for labelling a repo scope. */
function repoBasename(path: string): string {
  return (
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() || path
  );
}

function toRows(server: McpServer): EntryRow[] {
  const secretKeys = new Set(server.secretKeys);
  return entriesFor(server).map((e) => ({
    rowId: crypto.randomUUID(),
    key: e.key,
    value: e.value,
    secret: secretKeys.has(e.key),
    secretInput: "",
  }));
}

/** Add/edit dialog for one MCP server. Mounted with a `key` so each open starts
 *  from fresh local state. Save persists secret values to the OS keychain, then
 *  hands the (secret-free) server up to the settings form. */
function McpServerDialog({
  initial,
  others,
  repoPath,
  repoName,
  onSave,
  onClose,
}: {
  initial: McpServer | null;
  /** The other servers in the registry, for duplicate-name detection. */
  others: McpServer[];
  /** The repo open behind Settings (for the "This repo" scope option). */
  repoPath: string | null;
  repoName: string | null;
  onSave: (server: McpServer) => void;
  onClose: () => void;
}) {
  const editing = initial !== null;
  const [draft, setDraft] = useState<McpServer>(initial ?? emptyMcpServer());
  const [rows, setRows] = useState<EntryRow[]>(initial ? toRows(initial) : []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStdio = draft.transport === "stdio";
  const set = <K extends keyof McpServer>(key: K, value: McpServer[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setRow = (rowId: string, patch: Partial<EntryRow>) =>
    setRows((rs) =>
      rs.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    );

  // Scope choices: always Global; "This repo" when one is open; plus the server's
  // own scope when it points at a DIFFERENT repo (editing it elsewhere), so that
  // assignment is preserved rather than silently dropped.
  const scopeOptions: { value: string; label: string }[] = [
    { value: MCP_SCOPE_GLOBAL, label: "Global — all repositories" },
  ];
  if (repoPath)
    scopeOptions.push({
      value: repoPath,
      label: `This repo — ${repoName ?? repoBasename(repoPath)}`,
    });
  const curScope = serverScope(draft);
  if (curScope !== MCP_SCOPE_GLOBAL && curScope !== repoPath)
    scopeOptions.push({
      value: curScope,
      label: `${repoBasename(curScope)} — other repo`,
    });

  // Reconstruct a candidate server from the live draft + rows for validation.
  function candidate(): McpServer {
    const entries = rows.map((r) => ({
      key: r.key.trim(),
      value: r.secret ? "" : r.value,
    }));
    const secretKeys = rows.filter((r) => r.secret).map((r) => r.key.trim());
    return {
      ...draft,
      name: draft.name.trim(),
      args: draft.args,
      env: isStdio ? entries : [],
      headers: isStdio ? [] : entries,
      secretKeys,
    };
  }

  const validationError = validateMcpServer(candidate(), others);

  async function save() {
    if (validationError) {
      setError(validationError);
      return;
    }
    const server = candidate();
    setSaving(true);
    setError(null);
    try {
      // Write any newly-typed secret values to the keychain (keyed per server +
      // entry name); only the names are kept in `secretKeys`, never the values.
      for (const row of rows) {
        if (row.secret && row.secretInput.trim())
          await setMcpSecret(server.id, row.key.trim(), row.secretInput);
      }
      // Clean up keychain entries for keys that are no longer secret (renamed,
      // removed, or flipped back to a plain value).
      const liveSecretKeys = new Set(server.secretKeys);
      for (const old of initial?.secretKeys ?? []) {
        if (!liveSecretKeys.has(old)) await deleteMcpSecret(server.id, old);
      }
      onSave(server);
    } catch (e) {
      setSaving(false);
      toastError(e);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit MCP server" : "Add MCP server"}
          </DialogTitle>
          <DialogDescription>
            A Model Context Protocol server an agent session can opt into. Only
            the servers a session picks are passed to its CLI — nothing else on
            your machine is inherited.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-1">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div className="space-y-2">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                autoFocus
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="filesystem"
                className="font-mono"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label>Transport</Label>
              <div className="flex gap-1">
                {(["stdio", "http"] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={draft.transport === t ? "default" : "outline"}
                    aria-pressed={draft.transport === t}
                    className="flex-1"
                    onClick={() => set("transport", t)}
                  >
                    {t === "stdio" ? "Local (stdio)" : "Remote (HTTP)"}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcp-desc">Description</Label>
            <Input
              id="mcp-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Local file operations"
            />
          </div>

          {scopeOptions.length > 1 && (
            <div className="space-y-2">
              <Label>Available in</Label>
              <Select
                value={serverScope(draft)}
                onValueChange={(v) => v && set("scope", v)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Repo-scoped servers only appear in that repo's sessions.
              </p>
            </div>
          )}

          {isStdio ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-command">Command</Label>
                <Input
                  id="mcp-command"
                  value={draft.command}
                  onChange={(e) => set("command", e.target.value)}
                  placeholder="npx"
                  className="font-mono"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-args">Arguments</Label>
                <Textarea
                  id="mcp-args"
                  value={draft.args.join("\n")}
                  onChange={(e) =>
                    set(
                      "args",
                      e.target.value.split("\n").map((a) => a.trimEnd()),
                    )
                  }
                  onBlur={() =>
                    set("args", draft.args.map((a) => a.trim()).filter(Boolean))
                  }
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
                  className="min-h-24 font-mono"
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  One argument per line.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="mcp-url">URL</Label>
              <Input
                id="mcp-url"
                value={draft.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className="font-mono"
                spellCheck={false}
              />
            </div>
          )}

          <EntryEditor
            label={isStdio ? "Environment variables" : "Headers"}
            keyPlaceholder={isStdio ? "API_KEY" : "Authorization"}
            rows={rows}
            editing={editing}
            onAdd={() =>
              setRows((rs) => [
                ...rs,
                {
                  rowId: crypto.randomUUID(),
                  key: "",
                  value: "",
                  secret: false,
                  secretInput: "",
                },
              ])
            }
            onChange={setRow}
            onRemove={(rowId) =>
              setRows((rs) => rs.filter((r) => r.rowId !== rowId))
            }
          />

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Offer this server to new sessions by default.
              </p>
            </div>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(v) => set("enabled", v)}
            />
          </label>
        </div>

        <DialogFooter>
          {error ? (
            <p className="mr-auto self-center text-xs text-destructive">
              {error}
            </p>
          ) : validationError ? (
            <p className="mr-auto self-center text-xs text-muted-foreground">
              {validationError}
            </p>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!!validationError || saving}>
            {editing ? "Save server" : "Add server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The env-var / header rows editor inside the dialog. Each row can hold a plain
 *  value or be marked secret (masked, stored in the keychain). */
function EntryEditor({
  label,
  keyPlaceholder,
  rows,
  editing,
  onAdd,
  onChange,
  onRemove,
}: {
  label: string;
  keyPlaceholder: string;
  rows: EntryRow[];
  editing: boolean;
  onAdd: () => void;
  onChange: (rowId: string, patch: Partial<EntryRow>) => void;
  onRemove: (rowId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
          <PlusIcon data-icon="inline-start" /> Add
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.rowId} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) => onChange(row.rowId, { key: e.target.value })}
                placeholder={keyPlaceholder}
                className="w-44 shrink-0 font-mono"
                spellCheck={false}
              />
              <Input
                type={row.secret ? "password" : "text"}
                value={row.secret ? row.secretInput : row.value}
                onChange={(e) =>
                  onChange(
                    row.rowId,
                    row.secret
                      ? { secretInput: e.target.value }
                      : { value: e.target.value },
                  )
                }
                placeholder={
                  row.secret
                    ? editing
                      ? "•••• (leave blank to keep saved)"
                      : "secret value"
                    : "value"
                }
                className="flex-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-pressed={row.secret}
                aria-label={
                  row.secret ? "Stored in keychain" : "Store in keychain"
                }
                title={
                  row.secret
                    ? "Secret — stored in your OS keychain"
                    : "Mark as a secret (store in OS keychain)"
                }
                onClick={() => onChange(row.rowId, { secret: !row.secret })}
              >
                {row.secret ? (
                  <LockSimpleIcon className="text-primary" />
                ) : (
                  <LockSimpleOpenIcon />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove"
                onClick={() => onRemove(row.rowId)}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-repo state picker for a GLOBAL server, shown on its row when a repo is
 *  open: On (available + default-on) / Optional (available, off by default) /
 *  Off (not offered here), or "Default" to follow the global Enabled. Muted
 *  while inheriting; solid once this repo overrides it. */
function PerRepoStateControl({
  server,
  repoPath,
  onChange,
}: {
  server: McpServer;
  repoPath: string;
  onChange: (state: McpRepoState | null) => void;
}) {
  const override = server.repoOverrides?.[repoPath];
  const baseline = server.enabled ? "On" : "Optional";
  return (
    <Select
      value={override ?? "default"}
      onValueChange={(v) =>
        v && onChange(v === "default" ? null : (v as McpRepoState))
      }
    >
      <SelectTrigger
        size="sm"
        aria-label={`Availability of ${server.name} in this repo`}
        className={`w-auto gap-1 ${override ? "" : "text-muted-foreground"}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">Default · {baseline}</SelectItem>
        <SelectItem value="on">On</SelectItem>
        <SelectItem value="optional">Optional</SelectItem>
        <SelectItem value="off">Off</SelectItem>
      </SelectContent>
    </Select>
  );
}

export const McpServersSection = withForm({
  ...settingsFormOpts,
  render: function McpServersSectionRender({ form }) {
    const servers = useSelector(form.store, (s) => s.values.mcpServers);
    const [editing, setEditing] = useState<McpServer | "new" | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const listRef = useRef<HTMLDivElement>(null);
    const repoPath = useUiStore((s) => s.repoPath);
    const repoName = useUiStore((s) => s.repoName);

    const list = servers ?? [];

    function setServers(next: McpServer[]) {
      form.setFieldValue("mcpServers", next);
    }

    function addServers(added: McpServer[]) {
      if (added.length) setServers([...list, ...added]);
      setImportOpen(false);
    }

    function saveServer(server: McpServer) {
      const exists = list.some((s) => s.id === server.id);
      setServers(
        exists
          ? list.map((s) => (s.id === server.id ? server : s))
          : [...list, server],
      );
      setEditing(null);
    }

    function removeServer(server: McpServer) {
      setServers(list.filter((s) => s.id !== server.id));
      // Tidy up any keychain secrets the server owned (best-effort).
      for (const key of server.secretKeys)
        void deleteMcpSecret(server.id, key).catch(() => undefined);
      toast.success(`Removed "${server.name}"`);
    }

    function toggleEnabled(server: McpServer, enabled: boolean) {
      setServers(list.map((s) => (s.id === server.id ? { ...s, enabled } : s)));
    }

    // Set (or clear, when null = "follow the global default") a global server's
    // per-repo state override for the open repo.
    function setRepoOverride(
      server: McpServer,
      rp: string,
      state: McpRepoState | null,
    ) {
      setServers(
        list.map((s) => {
          if (s.id !== server.id) return s;
          const overrides = { ...(s.repoOverrides ?? {}) };
          if (state) overrides[rp] = state;
          else delete overrides[rp];
          const next: McpServer = { ...s, repoOverrides: overrides };
          if (Object.keys(overrides).length === 0)
            next.repoOverrides = undefined;
          return next;
        }),
      );
    }

    // Group by scope so global vs repo-specific servers read as distinct sets.
    const groups: {
      key: string;
      label: string;
      hint?: string;
      servers: McpServer[];
    }[] = [
      {
        key: "global",
        label: "Global — all repositories",
        // With a repo open, the per-row control sets this repo's override.
        hint: repoPath
          ? "Set how each behaves in this repo, or Default to follow the global setting."
          : undefined,
        servers: list.filter((s) => serverScope(s) === MCP_SCOPE_GLOBAL),
      },
      {
        key: "repo",
        label: `This repo — ${repoName ?? (repoPath ? repoBasename(repoPath) : "")}`,
        servers: repoPath
          ? list.filter((s) => serverScope(s) === repoPath)
          : [],
      },
      {
        key: "other",
        label: "Other repositories",
        servers: list.filter((s) => {
          const sc = serverScope(s);
          return sc !== MCP_SCOPE_GLOBAL && sc !== repoPath;
        }),
      },
    ].filter((g) => g.servers.length > 0);
    // Flattened in display order, so arrow-key nav follows what's on screen.
    const ordered = groups.flatMap((g) => g.servers);
    const indexById = new Map(ordered.map((s, i) => [s.id, i]));
    const showHeaders = groups.length > 1;
    // Removing/adding rows changes `ordered`'s length but not `activeIndex`, so
    // clamp the stale value (keeping -1 = "nothing active yet") to avoid leaving
    // no row focusable when the active row is removed.
    const safeActive =
      activeIndex >= ordered.length ? ordered.length - 1 : activeIndex;

    const onKeyDown = listKeyboardNav<McpServer>({
      items: ordered,
      activeIndex: safeActive,
      onActivate: (_s, to) => setActiveIndex(to),
      rowKey: (s) => s.id,
      rowAttr: "data-mcp-row",
    });

    return (
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">MCP servers</h2>
            <p className="text-xs text-muted-foreground">
              Register Model Context Protocol servers that agent sessions can
              opt into. Each session passes{" "}
              <strong className="font-medium">only</strong> the servers you pick
              to its CLI in strict mode, so a run never inherits other MCP
              servers on your machine. Secrets are stored in your OS keychain.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setImportOpen(true)}
              title="Import servers you've already configured (.mcp.json / global)"
            >
              <DownloadSimpleIcon data-icon="inline-start" /> Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing("new")}
            >
              <PlusIcon data-icon="inline-start" /> Add server
            </Button>
          </div>
        </div>

        {list.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No MCP servers yet. Add one to make it available in the agent
            composer's server picker.
          </p>
        ) : (
          // A roving-focus list (arrow keys move between rows); grouped by scope.
          <div ref={listRef} onKeyDown={onKeyDown} className="space-y-3">
            {groups.map((g) => (
              <div
                key={g.key}
                role="group"
                aria-label={g.label}
                className="space-y-2"
              >
                {showHeaders && (
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {g.label}
                    </p>
                    {g.hint && (
                      <p className="text-[11px] text-muted-foreground">
                        {g.hint}
                      </p>
                    )}
                  </div>
                )}
                {g.servers.map((server) => {
                  const i = indexById.get(server.id) ?? 0;
                  const isGlobal = serverScope(server) === MCP_SCOPE_GLOBAL;
                  return (
                    <div
                      key={server.id}
                      data-mcp-row={server.id}
                      aria-label={`${server.name}, ${server.transport}, ${effectiveMcpState(
                        server,
                        repoPath,
                      )}. Press Enter to edit.`}
                      tabIndex={
                        i === safeActive || (safeActive === -1 && i === 0)
                          ? 0
                          : -1
                      }
                      onFocus={() => setActiveIndex(i)}
                      onKeyDown={(e) => {
                        // Only the row itself edits on Enter — not when a child
                        // control (the state picker / switch / buttons) is focused.
                        if (e.key === "Enter" && e.target === e.currentTarget) {
                          e.preventDefault();
                          setEditing(server);
                        }
                      }}
                      className="flex items-center gap-2 rounded border px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span className="shrink-0 font-mono text-xs font-medium">
                        {server.name}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
                        {server.transport}
                      </span>
                      {server.description && (
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {server.description}
                        </span>
                      )}
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        {isGlobal && repoPath ? (
                          <PerRepoStateControl
                            server={server}
                            repoPath={repoPath}
                            onChange={(state) =>
                              setRepoOverride(server, repoPath, state)
                            }
                          />
                        ) : (
                          <Switch
                            size="sm"
                            checked={server.enabled}
                            onCheckedChange={(v) => toggleEnabled(server, v)}
                            aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${server.name}`}
                          onClick={() => setEditing(server)}
                        >
                          <PencilSimpleIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${server.name}`}
                          onClick={() => removeServer(server)}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {editing !== null && (
          <McpServerDialog
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            others={list.filter(
              (s) => editing === "new" || s.id !== editing.id,
            )}
            repoPath={repoPath}
            repoName={repoName}
            onSave={saveServer}
            onClose={() => setEditing(null)}
          />
        )}

        {importOpen && (
          <ImportMcpDialog
            repoPath={repoPath}
            existing={list}
            onImport={addServers}
            onClose={() => setImportOpen(false)}
          />
        )}
      </section>
    );
  },
});

/**
 * Reviewed import of servers the user already configured for Claude — the open
 * repo's `.mcp.json` and the global `~/.claude.json`. Nothing is inherited
 * silently: discovered servers land **disabled**, secret-looking values move to
 * the keychain, and the source files are never touched. The user ticks what to add.
 */
function ImportMcpDialog({
  repoPath,
  existing,
  onImport,
  onClose,
}: {
  repoPath: string | null;
  existing: McpServer[];
  onImport: (servers: McpServer[]) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  // Read the registry through a ref so discovery runs once (keyed on repoPath)
  // and isn't re-triggered — wiping the user's ticks — by the parent handing a
  // new `existing` array reference on re-render.
  const existingRef = useRef(existing);
  existingRef.current = existing;

  useEffect(() => {
    let alive = true;
    const existingNames = new Set(
      existingRef.current.map((s) => s.name.trim().toLowerCase()),
    );
    discoverMcpServers(repoPath)
      .then((found) => {
        if (!alive) return;
        const cands = found.map((d) =>
          toImportCandidate(d, existingNames, repoPath),
        );
        setCandidates(cands);
        // Pre-tick everything that isn't already in the registry.
        setPicked(
          new Set(cands.filter((c) => !c.duplicate).map((c) => c.server.id)),
        );
      })
      .catch((e) => {
        if (alive) toastError(e);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [repoPath]);

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function runImport() {
    const chosen = candidates.filter((c) => picked.has(c.server.id));
    if (chosen.length === 0) return;
    setImporting(true);
    try {
      // Stash secret-looking values in the keychain before the server lands in
      // settings (so the value is never persisted there). Best-effort per entry.
      for (const c of chosen) {
        for (const s of c.secretWrites)
          await setMcpSecret(c.server.id, s.key, s.value);
      }
      onImport(chosen.map((c) => c.server));
      toast.success(
        `Imported ${chosen.length} server${chosen.length === 1 ? "" : "s"} — review and enable them`,
      );
    } catch (e) {
      setImporting(false);
      toastError(e);
    }
  }

  const pickedCount = candidates.filter((c) => picked.has(c.server.id)).length;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !importing) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import MCP servers</DialogTitle>
          <DialogDescription>
            Servers already configured for Claude — the open repo's{" "}
            <code className="font-mono">.mcp.json</code> and your global config.
            Imported servers start{" "}
            <strong className="font-medium">disabled</strong> and secret-looking
            values move to your OS keychain; the source files aren't changed.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto px-1">
          {loading ? (
            <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
              <Spinner /> Looking for configured servers…
            </p>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-xs text-muted-foreground">
              No MCP servers found in {repoPath ? "this repo's " : ""}
              <code className="font-mono">.mcp.json</code>
              {repoPath ? " or " : ""}your global Claude config.
            </p>
          ) : (
            candidates.map((c) => (
              <label
                key={c.server.id}
                className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
                  c.duplicate ? "opacity-60" : "cursor-pointer hover:bg-muted"
                }`}
              >
                <Checkbox
                  checked={picked.has(c.server.id)}
                  disabled={c.duplicate || importing}
                  onCheckedChange={(on) => toggle(c.server.id, on === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono font-medium">
                      {c.server.name}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground uppercase">
                      {c.server.transport}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {c.origin === "repo" ? ".mcp.json" : "global"}
                    </span>
                  </div>
                  <p className="truncate text-muted-foreground">
                    {c.server.transport === "stdio"
                      ? [c.server.command, ...c.server.args].join(" ")
                      : c.server.url}
                  </p>
                  {c.duplicate ? (
                    <p className="text-[10px] text-muted-foreground">
                      Already in your registry.
                    </p>
                  ) : (
                    (c.renamed || c.server.secretKeys.length > 0) && (
                      <p className="text-[10px] text-muted-foreground">
                        {c.renamed && `Renamed from “${c.sourceName}”. `}
                        {c.server.secretKeys.length > 0 &&
                          `${c.server.secretKeys.length} secret value${
                            c.server.secretKeys.length === 1 ? "" : "s"
                          } → keychain.`}
                      </p>
                    )
                  )}
                </div>
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            onClick={runImport}
            disabled={pickedCount === 0 || importing || loading}
          >
            {importing && <Spinner data-icon="inline-start" />}
            Import{pickedCount > 0 ? ` ${pickedCount}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
