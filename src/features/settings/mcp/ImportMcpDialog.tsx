import { useEffect, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { setMcpSecret } from "@/lib/git/api";
import type { McpServer } from "@/lib/settings/api";
import {
  discoverMcpServers,
  type ImportCandidate,
  toImportCandidate,
} from "@/lib/settings/mcp-import";
import { toastError } from "@/lib/toast";
import { useLatestRef } from "@/lib/use-latest-ref";

/**
 * Reviewed import of servers the user already configured for Claude — the open
 * repo's `.mcp.json` and the global `~/.claude.json`. Nothing is inherited
 * silently: discovered servers land **disabled**, secret-looking values move to
 * the keychain, and the source files are never touched. The user ticks what to add.
 */
export function ImportMcpDialog({
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
  const existingRef = useLatestRef(existing);

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
