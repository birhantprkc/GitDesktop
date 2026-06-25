import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stopTestContainer, testContainerRunning } from "@/lib/ai/sandbox";
import { toastError } from "@/lib/toast";

/** Vite's default — the most common dev port, pre-filled so one click just works. */
export const DEFAULT_PORTS = "5173";

/** Split a free-text port field on commas/whitespace into individual specs; the Rust
 *  side validates each (`PORT` or `host:container`). */
export const parsePorts = (raw: string): string[] =>
  raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The pre-launch panel for a **container** test shell: choose which dev-server
 * port(s) to publish *before* the container spins up — a fixed list dies when any
 * one port is already bound on the host, so the ports have to be set first, not
 * after. And because the container outlives a *closed* shell (closing the window
 * kills the shell client, not the container), on mount it checks whether one is
 * already running: if so it offers to **reconnect** a new shell or **stop** it
 * (freeing the ports) rather than vainly starting a second.
 *
 * Rendered in the popover on a container session's **Terminal** button, so ports
 * are chosen before the container spins up. `onStart` gets the parsed ports for a
 * fresh run; `onReconnect` joins a shell to the already-running container (its
 * ports are fixed by the first run, so none are passed). The caller decides what
 * "open a shell" does — mount the in-app terminal, or (when `onOpenExternal` is
 * supplied) spawn an external one. `onOpenExternal` is an optional escape hatch
 * shown as a secondary button (wired only in dev, so the working external shell
 * stays reachable from the same flow if the in-app PTY misbehaves in a dev build).
 */
export function ContainerLaunchPanel({
  worktreePath,
  onStart,
  onReconnect,
  onOpenExternal,
}: {
  worktreePath: string;
  onStart: (ports: string[]) => void;
  onReconnect: () => void;
  onOpenExternal?: (ports: string[]) => void;
}) {
  const [ports, setPorts] = useState(DEFAULT_PORTS);
  // null = haven't checked yet; otherwise whether a container is already up.
  const [running, setRunning] = useState<boolean | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let active = true;
    setRunning(null);
    testContainerRunning(worktreePath)
      .then((r) => active && setRunning(r))
      .catch(() => active && setRunning(false));
    return () => {
      active = false;
    };
  }, [worktreePath]);

  const stop = () => {
    setStopping(true);
    stopTestContainer(worktreePath)
      .then(() => setRunning(false))
      .catch(toastError)
      .finally(() => setStopping(false));
  };

  if (running === null) {
    return <p className="text-[11px] text-muted-foreground">Checking…</p>;
  }

  if (running) {
    return (
      <>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A container for this session is{" "}
          <span className="text-foreground">already running</span> — its server
          and published ports are still up (closing the shell doesn't stop it).
          Reconnect a new shell, or stop it to free the ports.
        </p>
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" className="flex-1" onClick={onReconnect}>
            Reconnect
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={stopping}
            onClick={stop}
          >
            {stopping ? "Stopping…" : "Stop container"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Opens a shell in the same image with this session's worktree mounted, so
        its Linux deps and build match.
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
              onStart(parsePorts(ports));
            }
          }}
          placeholder="5173"
          spellCheck={false}
        />
      </label>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        Space/comma separated. Use{" "}
        <code className="font-mono">host:container</code> (e.g.{" "}
        <code className="font-mono">5174:5173</code>) if a host port is busy.
        Bind your dev server to <code className="font-mono">0.0.0.0</code> (
        <code className="font-mono">pnpm dev --host</code>).
      </p>
      <Button
        size="sm"
        className="mt-2.5 w-full"
        onClick={() => onStart(parsePorts(ports))}
      >
        Open shell
      </Button>
      {onOpenExternal && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1.5 w-full"
          onClick={() => onOpenExternal(parsePorts(ports))}
          title="Open the container shell in an external terminal window"
        >
          Open in external terminal
        </Button>
      )}
    </>
  );
}
