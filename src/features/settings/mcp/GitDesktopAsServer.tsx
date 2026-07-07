import { CaretRightIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  appExePath,
  mcpGlobalInstall,
  mcpJsonWrite,
  type PathLauncherStatus,
  pathLauncherInstall,
  pathLauncherRemove,
  pathLauncherStatus,
} from "@/lib/git/api";
import { toastError } from "@/lib/toast";

/** Where a one-click install writes the `gitdesktop` entry: this repo's
 *  `.mcp.json`, or a client's global (all-projects) user config. */
type InstallTarget = "project" | "claude" | "copilot";

/** Bottom-of-section disclosure: the inverse of the rest of this panel. Instead of
 *  consuming MCP servers, expose GitDesktop's OWN read-only git/GitHub tools to
 *  external clients, which run the app as a stdio server via `gitdesktop mcp`.
 *  Collapsed by default — it's a one-time setup, not part of the daily list. */
export function GitDesktopAsServer({ repoPath }: { repoPath: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Checkboxes shape the emitted config: Shareable (portable env-var paths a
  // teammate can commit) vs Personal (absolute machine paths); and two separate,
  // orthogonal write opt-ins — local-PR tools (`--allow-write`) and real forge
  // writes (`--allow-remote-write`).
  const [shareable, setShareable] = useState(false);
  const [allowWrite, setAllowWrite] = useState(false);
  const [allowRemoteWrite, setAllowRemoteWrite] = useState(false);
  // One install at a time: `busyTarget` is which is running, `confirmTarget` which
  // is awaiting a replace-confirm. "project" = this repo's .mcp.json;
  // "claude"/"copilot" = that client's global (all-projects) user config.
  const [busyTarget, setBusyTarget] = useState<InstallTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<InstallTarget | null>(
    null,
  );
  // The command-line launcher: is `gitdesktop` on PATH, and did we put it there?
  // Only fetched while the disclosure is open (it reads the registry / $PATH).
  const queryClient = useQueryClient();
  const { data: launcher, isLoading: launcherLoading } = useQuery({
    queryKey: ["path-launcher-status"],
    queryFn: pathLauncherStatus,
    enabled: open,
  });
  const [pathBusy, setPathBusy] = useState(false);
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
    if (allowRemoteWrite) args.push("--allow-remote-write");
    return {
      command: shareable
        ? "${GITDESKTOP_BIN:-gitdesktop}"
        : (exePath ?? "gitdesktop"),
      args,
    };
  }, [shareable, allowWrite, allowRemoteWrite, repoPath, exePath]);

  const snippet = JSON.stringify(
    { mcpServers: { gitdesktop: entry } },
    null,
    2,
  );

  // One-line summary of what the emitted config exposes, reflecting both
  // independent write opt-ins (either, both, or neither).
  const writeTiers = [
    allowWrite && "local-PR tools (--allow-write)",
    allowRemoteWrite && "remote forge writes (--allow-remote-write)",
  ].filter(Boolean);
  const modeNote = writeTiers.length
    ? `Read-write · stdio · ${writeTiers.join(" + ")}.`
    : "Read-only · stdio · exposes git & forge tools (status, log, diff, blame, PRs, issues, CI).";

  async function copy() {
    await copyText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // The entry a GLOBAL (all-projects) install writes: the absolute exe + a DYNAMIC
  // repo so the server follows whatever project the client is in. The repo var is
  // client-specific — Claude Code expands ${CLAUDE_PROJECT_DIR}; Copilot has no
  // equivalent, so it gets "." and relies on the client launching the server from
  // the workspace folder. The write toggles carry over.
  function globalEntry(target: "claude" | "copilot") {
    const args = [
      "mcp",
      "--repo",
      target === "claude" ? "${CLAUDE_PROJECT_DIR:-.}" : ".",
    ];
    if (allowWrite) args.push("--allow-write");
    if (allowRemoteWrite) args.push("--allow-remote-write");
    return { command: exePath ?? "gitdesktop", args };
  }

  function installSuccessToast(target: InstallTarget) {
    if (target === "project") {
      toast.success(
        shareable
          ? ".mcp.json written — commit it to share with your team"
          : ".mcp.json written — paths are machine-specific, consider gitignoring it",
      );
      return;
    }
    const client = target === "claude" ? "Claude Code" : "Copilot";
    toast.success(
      `Added gitdesktop to ${client} — available in all your projects (restart the client).`,
    );
  }

  // Install to a target without clobbering an existing entry; if one exists, ask
  // before replacing. `overwrite` is only ever true on the confirm path.
  async function install(target: InstallTarget, overwrite: boolean) {
    if (busyTarget) return;
    if (target === "project" && !repoPath) return;
    setBusyTarget(target);
    try {
      let result: { written: boolean; existed: boolean };
      if (target === "project") {
        result = await mcpJsonWrite(repoPath as string, entry, overwrite);
      } else {
        const { command, args } = globalEntry(target);
        result = await mcpGlobalInstall(target, command, args, overwrite);
      }
      if (result.existed && !result.written) {
        setConfirmTarget(target);
        return;
      }
      setConfirmTarget(null);
      installSuccessToast(target);
    } catch (e) {
      toastError(e);
    } finally {
      setBusyTarget(null);
    }
  }

  // Run an install/remove and fold the authoritative result back into the cache.
  // `note` is a one-shot success line (shown as a toast); the rest is persistent.
  async function runLauncher(action: () => Promise<PathLauncherStatus>) {
    if (pathBusy) return;
    setPathBusy(true);
    try {
      const next = await action();
      queryClient.setQueryData<PathLauncherStatus>(["path-launcher-status"], {
        ...next,
        note: null,
      });
      if (next.note) toast.success(next.note);
    } catch (e) {
      toastError(e);
    } finally {
      setPathBusy(false);
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
                ? "Portable paths — teammates set GITDESKTOP_BIN to their install path, or add gitdesktop to their PATH (see below)."
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
                : "The server exposes read-only git & forge tools."}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={allowRemoteWrite}
                onCheckedChange={(c) => setAllowRemoteWrite(c === true)}
              />
              Allow remote write
            </label>
            <p className="text-xs text-muted-foreground">
              {allowRemoteWrite
                ? "Adds --allow-remote-write — real forge writes under your CLI identity: create, close/reopen, and comment on issues, and comment on PRs (issues on GitHub & GitLab; PR comments on all three). Separate opt-in from Allow write tools."
                : "No real forge writes — issues and pull requests on the remote are left untouched."}
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
                  disabled={!repoPath || busyTarget !== null}
                  onClick={() => install("project", false)}
                >
                  {busyTarget === "project" ? (
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
          <p className="text-xs text-muted-foreground">{modeNote}</p>

          {/* Install globally — one click into a client's user config (all
              projects), via its own CLI. Uses a project-aware --repo so a single
              global entry follows whatever repo the client opens. */}
          <div className="mt-1 space-y-1.5 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">
                Install globally — all projects
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyTarget !== null}
                  onClick={() => install("claude", false)}
                >
                  {busyTarget === "claude" ? (
                    <>
                      <Spinner className="size-3" /> Adding…
                    </>
                  ) : (
                    "Claude Code"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyTarget !== null}
                  onClick={() => install("copilot", false)}
                >
                  {busyTarget === "copilot" ? (
                    <>
                      <Spinner className="size-3" /> Adding…
                    </>
                  ) : (
                    "Copilot"
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Adds gitdesktop to the client's user config via its CLI, so it's
              in every project — no per-repo{" "}
              <code className="font-mono">.mcp.json</code>. The write toggles
              above carry over.
            </p>
          </div>

          {/* Command-line launcher — make `gitdesktop` resolve in any terminal
              so the bare command above works without a hardcoded path. */}
          <div className="mt-1 space-y-1.5 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Command-line launcher</span>
              {launcherLoading ? (
                <span className="text-[11px] text-muted-foreground">
                  Checking…
                </span>
              ) : launcher?.onPath ? (
                launcher.managed ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pathBusy}
                    onClick={() => runLauncher(pathLauncherRemove)}
                  >
                    {pathBusy ? (
                      <>
                        <Spinner className="size-3" /> Removing…
                      </>
                    ) : (
                      "Remove"
                    )}
                  </Button>
                ) : null
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pathBusy}
                  onClick={() => runLauncher(pathLauncherInstall)}
                >
                  {pathBusy ? (
                    <>
                      <Spinner className="size-3" /> Adding…
                    </>
                  ) : (
                    "Add to PATH"
                  )}
                </Button>
              )}
            </div>
            {!launcherLoading &&
              (launcher?.onPath ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckIcon className="shrink-0" />
                  <span>
                    gitdesktop is on your PATH
                    {!launcher.managed && " — added outside GitDesktop"}
                  </span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Make <code className="font-mono">gitdesktop</code> runnable
                  from any terminal, so the command above works without a full
                  path.
                </p>
              ))}
            {launcher?.warning && (
              <p className="text-xs text-warning">{launcher.warning}</p>
            )}
          </div>

          <Dialog
            open={confirmTarget !== null}
            onOpenChange={(o) => {
              // Don't let Escape/backdrop dismiss mid-replace (the Cancel button
              // is disabled then too), or the install finishes and fires a success
              // toast after the user thought they'd cancelled.
              if (!o && busyTarget === null) setConfirmTarget(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Replace existing entry?</DialogTitle>
                <DialogDescription>
                  {confirmTarget === "project"
                    ? "This repo's .mcp.json already has a gitdesktop entry. Replace it with the configuration shown?"
                    : `${confirmTarget === "claude" ? "Claude Code" : "Copilot"}'s user config already has a gitdesktop server. Replace it?`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyTarget !== null}
                  onClick={() => setConfirmTarget(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busyTarget !== null}
                  onClick={() => confirmTarget && install(confirmTarget, true)}
                >
                  {busyTarget !== null ? (
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
