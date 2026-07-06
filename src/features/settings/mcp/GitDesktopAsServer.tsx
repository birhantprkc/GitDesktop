import { CaretRightIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { copyText } from "@/lib/clipboard";
import { appExePath, mcpJsonWrite } from "@/lib/git/api";
import { toastError } from "@/lib/toast";

/** Bottom-of-section disclosure: the inverse of the rest of this panel. Instead of
 *  consuming MCP servers, expose GitDesktop's OWN read-only git/GitHub tools to
 *  external clients, which run the app as a stdio server via `gitdesktop mcp`.
 *  Collapsed by default — it's a one-time setup, not part of the daily list. */
export function GitDesktopAsServer({ repoPath }: { repoPath: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Two config variants driven by checkboxes: Shareable (portable env-var paths
  // a teammate can commit) vs Personal (absolute machine paths), and whether to
  // expose the opt-in local-PR write tools (`--allow-write`).
  const [shareable, setShareable] = useState(false);
  const [allowWrite, setAllowWrite] = useState(false);
  const [writing, setWriting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The command is this app's own executable; resolved once (it can't change
  // mid-session). Falls back to a bare name only while the path is loading.
  const { data: exePath } = useQuery({
    queryKey: ["app-exe-path"],
    queryFn: appExePath,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Single source of truth for both Copy and Write — the exact entry that gets
  // merged into .mcp.json under `mcpServers.gitdesktop`.
  const entry = useMemo(() => {
    const args = shareable
      ? ["mcp", "--repo", "${CLAUDE_PROJECT_DIR:-.}"]
      : ["mcp", "--repo", repoPath ?? "<path to your repo>"];
    if (allowWrite) args.push("--allow-write");
    return {
      command: shareable
        ? "${GITDESKTOP_BIN:-gitdesktop}"
        : (exePath ?? "gitdesktop"),
      args,
    };
  }, [shareable, allowWrite, repoPath, exePath]);

  const snippet = JSON.stringify(
    { mcpServers: { gitdesktop: entry } },
    null,
    2,
  );

  async function copy() {
    await copyText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Fire the toast whose wording matches the variant just written.
  function writeSuccessToast() {
    toast.success(
      shareable
        ? ".mcp.json written — commit it to share with your team"
        : ".mcp.json written — paths are machine-specific, consider gitignoring it",
    );
  }

  // Write .mcp.json without clobbering an existing entry; if one exists, ask
  // before replacing. `overwrite` is only ever true on the confirm path.
  async function write(overwrite: boolean) {
    if (!repoPath || writing) return;
    setWriting(true);
    try {
      const result = await mcpJsonWrite(repoPath, entry, overwrite);
      if (result.existed && !result.written) {
        setConfirmOpen(true);
        return;
      }
      setConfirmOpen(false);
      writeSuccessToast();
    } catch (e) {
      toastError(e);
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="border-t pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="gd-as-mcp-config"
        className="flex w-full items-start gap-2 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <CaretRightIcon
          className={`mt-0.5 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            Use GitDesktop as an MCP server
          </span>
          <span className="block text-xs text-muted-foreground">
            Let Claude Desktop, Cursor, or Claude Code use this repo's git &amp;
            GitHub tools — read-only by default, over stdio.
          </span>
        </span>
      </button>

      {open && (
        <div id="gd-as-mcp-config" className="mt-3 space-y-2 pl-6">
          {!repoPath && (
            <p className="text-xs text-muted-foreground">
              No repository open — replace{" "}
              <code className="font-mono">&lt;path to your repo&gt;</code> with
              the repo you want to expose.
            </p>
          )}

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={shareable}
                onCheckedChange={(c) => setShareable(c === true)}
              />
              Shareable entry
            </label>
            <p className="text-xs text-muted-foreground">
              {shareable
                ? "Portable paths — teammates set GITDESKTOP_BIN to their install path (or have gitdesktop on PATH)."
                : "Absolute paths — works on this machine only. Consider gitignoring .mcp.json."}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={allowWrite}
                onCheckedChange={(c) => setAllowWrite(c === true)}
              />
              Allow write tools
            </label>
            <p className="text-xs text-muted-foreground">
              {allowWrite
                ? "Adds --allow-write — agents can create, comment on, and approve this repo's local PRs."
                : "The server exposes read-only git & GitHub tools."}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              Paste into your client's MCP config
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={copy}>
                {copied ? (
                  <>
                    <CheckIcon data-icon="inline-start" /> Copied
                  </>
                ) : (
                  <>
                    <CopyIcon data-icon="inline-start" /> Copy
                  </>
                )}
              </Button>
              {/* A title on a natively-disabled button never surfaces, so wrap it. */}
              <span
                title={
                  repoPath
                    ? undefined
                    : "Open a repository to write its .mcp.json"
                }
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!repoPath || writing}
                  onClick={() => write(false)}
                >
                  {writing ? (
                    <>
                      <Spinner className="size-3" /> Writing…
                    </>
                  ) : (
                    "Write to .mcp.json"
                  )}
                </Button>
              </span>
            </div>
          </div>
          <pre className="overflow-x-auto rounded border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
            {snippet}
          </pre>
          <p className="text-xs text-muted-foreground">
            {allowWrite
              ? "Read-write · stdio · adds local-PR write tools (create, comment, status, approve) — gated behind --allow-write."
              : "Read-only · stdio · exposes git & GitHub tools (status, log, diff, blame, PRs, issues, CI)."}
          </p>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Replace existing entry?</DialogTitle>
                <DialogDescription>
                  This repo's .mcp.json already has a gitdesktop entry. Replace
                  it with the configuration shown?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={writing}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={writing}
                  onClick={() => write(true)}
                >
                  {writing ? (
                    <>
                      <Spinner className="size-3" /> Replacing…
                    </>
                  ) : (
                    "Replace entry"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
