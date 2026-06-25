import { invoke } from "@/lib/tauri/invoke";

/** Whether container isolation for agent sessions is usable on this machine. */
export interface ContainerStatus {
  /** "docker" | "podman", or null if neither is installed. */
  runtime: "docker" | "podman" | null;
  /** The runtime is installed AND its engine is reachable. */
  ready: boolean;
  /** The managed agent image has been built (any config). */
  imagePresent: boolean;
  /** The built image matches the current Node version + providers; `false` while
   *  `imagePresent` is true means a rebuild is needed to apply the change. */
  imageMatches: boolean;
}

/** Detects Docker/Podman availability + whether the agent image (for this Node
 *  version + provider set) needs building or rebuilding. */
export const detectContainerSandbox = (
  nodeVersion: string,
  providers: string[],
) =>
  invoke<ContainerStatus>("agent_container_detect", { nodeVersion, providers });

/** Builds (or, with `force`, rebuilds from scratch — `--no-cache --pull`, to pick
 *  up newer CLI/Node releases) the managed agent image for the given config. */
export const prepareContainerSandbox = (
  nodeVersion: string,
  providers: string[],
  force: boolean,
) => invoke<void>("agent_container_prepare", { nodeVersion, providers, force });

/** Removes a session's container claude-home + any lingering container. */
export const cleanupContainerSandbox = (sessionId: string) =>
  invoke<void>("agent_sandbox_cleanup", { sessionId });

/** Opens an interactive shell in a container with the session's worktree mounted,
 *  so a container session can be tested in its matching Linux env. `ports` are the
 *  dev-server ports to publish to the host loopback — each a bare `"5173"` or a
 *  `"host:container"` remap (e.g. `"5174:5173"`) when a host port is busy. Empty =
 *  publish nothing. If a container for this worktree is **already running** (its
 *  terminal was closed without exiting), this reconnects a new shell into it and
 *  `ports` are ignored (they belong to the original run). */
export const openContainerShell = (worktreePath: string, ports: string[]) =>
  invoke<void>("agent_open_container_shell", { worktreePath, ports });

/** Whether this worktree's test-shell container is currently running — so the UI
 *  can offer to reconnect to it or stop it instead of starting a new one. */
export const testContainerRunning = (worktreePath: string) =>
  invoke<boolean>("agent_test_container_running", { worktreePath });

/** Force-stops + removes this worktree's test-shell container, freeing its
 *  published ports. Best-effort (a no-op if it isn't running). */
export const stopTestContainer = (worktreePath: string) =>
  invoke<void>("agent_stop_test_container", { worktreePath });
