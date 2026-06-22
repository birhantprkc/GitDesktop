import { invoke } from "@/lib/tauri/invoke";

/** Whether container isolation for agent sessions is usable on this machine. */
export interface ContainerStatus {
  /** "docker" | "podman", or null if neither is installed. */
  runtime: "docker" | "podman" | null;
  /** The runtime is installed AND its engine is reachable. */
  ready: boolean;
  /** The managed agent image has been built. */
  imagePresent: boolean;
}

/** Detects Docker/Podman availability + whether the agent image needs building. */
export const detectContainerSandbox = () =>
  invoke<ContainerStatus>("agent_container_detect");

/** Builds the managed agent image (a few minutes on first run; cached after). */
export const prepareContainerSandbox = () =>
  invoke<void>("agent_container_prepare");

/** Removes a session's container claude-home + any lingering container. */
export const cleanupContainerSandbox = (sessionId: string) =>
  invoke<void>("agent_sandbox_cleanup", { sessionId });
