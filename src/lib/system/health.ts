import { useQuery } from "@tanstack/react-query";
import type { AuthStatus } from "@/lib/ai/agent";
import { invoke } from "@/lib/tauri/invoke";

/** One external CLI's detected status, mirroring the Rust `ToolStatus`. */
export interface ToolStatus {
  /** Stable id mapped to a label + install link ("git", "gh", …). */
  id: string;
  found: boolean;
  path: string | null;
  version: string | null;
  /** Login state for tools that have one; `unknown` doubles as "N/A" (git). */
  authed: AuthStatus;
}

export interface SystemInfo {
  os: string;
  osVersion: string;
  arch: string;
}

export interface SystemHealth {
  system: SystemInfo;
  tools: ToolStatus[];
}

/** OS/app diagnostics + the status of the CLIs GitDesktop shells out to, for
 *  the Settings → About screen. Detection runs concurrently in Rust. */
export function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"] as const,
    queryFn: () => invoke<SystemHealth>("system_health"),
    staleTime: 30_000,
  });
}
