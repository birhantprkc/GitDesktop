import { useState } from "react";
import type { TerminalLaunch } from "@/features/terminal/TerminalDock";
import { stopTestContainer } from "@/lib/ai/sandbox";
import { toastError } from "@/lib/toast";
import type { AgentSession } from "./store";

/**
 * The integrated-terminal state + actions for a session, lifted out of
 * SessionView. `terminalOpen` is the dock's visibility; `launch` is what the dock
 * renders (null until launched). A host shell launches immediately; a container
 * shell launches from the Terminal button's port popover, so the ports are chosen
 * before the container spins up — `launchPopoverOpen` lets the hotkey open that
 * popover too (not just a click on the trigger).
 */
export function useSessionTerminal(session: AgentSession) {
  const isContainer = session.isolation === "container";
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [launch, setLaunch] = useState<TerminalLaunch | null>(null);
  const [launchPopoverOpen, setLaunchPopoverOpen] = useState(false);

  // Launch (host shell, or a container shell with the popover-chosen ports) and
  // reveal the dock. `[]` ports = reconnect into an already-running container.
  const launchTerminal = (ports: string[]) => {
    setLaunch({ ports, token: 0 });
    setLaunchPopoverOpen(false);
    setTerminalOpen(true);
  };
  const restartTerminal = () =>
    setLaunch((l) => (l ? { ...l, token: l.token + 1 } : l));
  // Stop the container, drop the terminal (it unmounts → kills the shell client),
  // and close the dock; relaunching goes back through the port popover.
  const stopTerminal = () => {
    stopTestContainer(session.worktreePath).catch(toastError);
    setLaunch(null);
    setTerminalOpen(false);
  };
  // The button/hotkey: a container needs the port popover for its first launch;
  // once launched (or for a host shell) it just toggles the dock's visibility.
  const toggleTerminal = () => {
    if (isContainer && !launch) {
      setLaunchPopoverOpen((o) => !o);
    } else {
      if (!isContainer && !launch) setLaunch({ ports: [], token: 0 });
      setTerminalOpen((o) => !o);
    }
  };

  return {
    isContainer,
    terminalOpen,
    setTerminalOpen,
    launch,
    launchPopoverOpen,
    setLaunchPopoverOpen,
    launchTerminal,
    restartTerminal,
    stopTerminal,
    toggleTerminal,
  };
}
