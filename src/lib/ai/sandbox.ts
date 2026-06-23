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
