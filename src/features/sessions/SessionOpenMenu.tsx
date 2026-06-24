import { Popover } from "@base-ui/react/popover";
import {
  CaretDownIcon,
  FlaskIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { openContainerShell } from "@/lib/ai/sandbox";
import {
  openInTerminal,
  openWithDefault,
  openWithProgram,
  revealInExplorer,
} from "@/lib/git/api";
import { useSettings } from "@/lib/settings/queries";
import { toastError } from "@/lib/toast";

/** Vite's default — the most common dev port, pre-filled so one click just works. */
const DEFAULT_PORTS = "5173";

/** Split a free-text port field on commas/whitespace into individual specs; the Rust
 *  side validates each (`PORT` or `host:container`). */
const parsePorts = (raw: string): string[] =>
  raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Open a session's worktree so you can test it live — run it, poke at the files —
 * before deciding to Keep or Discard. The worktree is a full checkout on the
 * session's branch, isolated from your working tree.
 *
 * For a **container** session the host worktree's deps would be Linux builds (the
 * agent installed them inside the container), wrong on Windows/macOS — so the
 * primary test path is **Test** (a separate button): an interactive shell in the
 * same image with the worktree mounted, where `pnpm install` / running matches.
 */
export function SessionOpenMenu({
  worktreePath,
  isolation,
}: {
  worktreePath: string;
  isolation: "worktree" | "container";
}) {
  const settings = useSettings();
  const editorPath = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || "editor";
  const terminal = (settings.data?.terminal ?? "").trim();
  const terminalPath = (settings.data?.terminalPath ?? "").trim();
  const onError = (e: unknown) => toastError(e);
  const container = isolation === "container";

  return (
    <>
      {container && <ContainerTestButton worktreePath={worktreePath} />}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" />}
          title="Open the worktree to inspect the changes"
        >
          <FolderOpenIcon data-icon="inline-start" />
          Open
          <CaretDownIcon className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {editorPath && (
            <DropdownMenuItem
              onClick={() =>
                openWithProgram(editorPath, worktreePath).catch(onError)
              }
            >
              Open in {editorName}
            </DropdownMenuItem>
          )}
          {/* Host terminal/default are misleading for a container session (host env),
              so only the read-only views (editor / file manager) are offered there. */}
          {!container && (
            <DropdownMenuItem
              onClick={() =>
                openInTerminal(
                  worktreePath,
                  terminal || undefined,
                  terminalPath || undefined,
                ).catch(onError)
              }
            >
              Open in terminal
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => revealInExplorer(worktreePath).catch(onError)}
          >
            Reveal in file manager
          </DropdownMenuItem>
          {!container && (
            <DropdownMenuItem
              onClick={() => openWithDefault(worktreePath).catch(onError)}
            >
              Open with default program
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Launches an interactive shell inside the agent's container image with the
 * session worktree mounted — the Linux env that matches how the agent built things.
 * A small popover lets you choose which dev-server port(s) to publish to the host
 * before launching: pre-filled with Vite's `5173`, but overridable because a fixed
 * list dies when any one port is already bound on the host. Use `host:container`
 * (e.g. `5174:5173`) to reach the container on a free host port.
 */
function ContainerTestButton({ worktreePath }: { worktreePath: string }) {
  const [open, setOpen] = useState(false);
  const [ports, setPorts] = useState(DEFAULT_PORTS);

  const launch = () => {
    setOpen(false);
    openContainerShell(worktreePath, parsePorts(ports)).catch(toastError);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={<Button variant="outline" size="sm" />}
        title="Open a shell in the container image to test this session"
      >
        <FlaskIcon data-icon="inline-start" />
        Test
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={6} className="isolate z-50">
          <Popover.Popup className="w-80 bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <p className="text-xs font-medium">Test in container shell</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Opens a shell in the same image with this session's worktree
              mounted, so its Linux deps and build match.
            </p>
            <label className="mt-2.5 block text-[11px] font-medium">
              Publish ports
              <Input
                className="mt-1 font-mono"
                value={ports}
                onChange={(e) => setPorts(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    launch();
                  }
                }}
                placeholder="5173"
                spellCheck={false}
              />
            </label>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Space/comma separated. Use{" "}
              <code className="font-mono">host:container</code> (e.g.{" "}
              <code className="font-mono">5174:5173</code>) if a host port is
              busy. Bind your dev server to{" "}
              <code className="font-mono">0.0.0.0</code> (
              <code className="font-mono">pnpm dev --host</code>).
            </p>
            <Button size="sm" className="mt-2.5 w-full" onClick={launch}>
              Open shell
            </Button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
