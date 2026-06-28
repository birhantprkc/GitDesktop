import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { loadSettings } from "@/lib/settings/api";
import {
  hostLabel,
  isBuiltinOrLocalHost,
  isHostAllowed,
} from "./allowed-hosts";

/**
 * The Tauri fetch (proxied through Rust, so it's exempt from the webview CORS
 * most AI APIs reject) behind the AI host allowlist (`allowed-hosts.ts`).
 *
 * Every AI network call — inference (`providers.ts`) AND the live model-list
 * fetch (`models.ts`) — goes through this, so a custom Ollama / OpenAI-compatible
 * host is gated on BOTH paths. Built-in provider hosts and localhost pass without
 * a settings read; any other host must be on the user's allow list.
 * `allowedOverride` supplies an unsaved draft list (Settings "Test connection");
 * otherwise the SAVED list is read, so the gate applies even if a caller forgets
 * to pass it (fail-closed). The Tauri HTTP capability is opened to `http(s)://*`
 * as a coarse backstop — THIS check is the effective control.
 */
export function guardedFetch(
  allowedOverride?: readonly string[],
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    if (!isBuiltinOrLocalHost(url)) {
      const allowed = allowedOverride ?? (await loadSettings()).aiAllowedHosts;
      if (!isHostAllowed(url, allowed)) {
        throw new Error(
          `GitDesktop blocked a network request to "${hostLabel(url)}". Add it ` +
            "under Settings → AI → Allowed hosts to use a custom AI server.",
        );
      }
    }
    return tauriFetch(input, init);
  }) as typeof globalThis.fetch;
}
