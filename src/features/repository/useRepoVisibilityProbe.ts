import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { forgeRepoVisibility, gitRepoOwners } from "@/lib/git/api";
import { persistRepoVisibility } from "@/lib/settings/api";
import { settingsKeys } from "@/lib/settings/queries";

/**
 * On every successful repo open (this fires for every `repoPath` — including
 * app-relaunch restore), fire-and-forget refreshes the repo's stored
 * visibility badge:
 *
 * - Resolve the provider via `gitRepoOwners` (a cheap local read). When it's
 *   null (no remote, or the remote was removed), persist `{ visibility: null }`
 *   so a stale badge clears.
 * - When the provider is known, probe `forgeRepoVisibility` and persist the
 *   result. A rejection (signed out, API failure) persists nothing — the prior
 *   value is left alone.
 *
 * Never blocks or delays repo open, and swallows every error silently: this is
 * ambient metadata, not a user-facing action (no toasts).
 *
 * Persistence goes through the raw helper + a captured queryClient (both stable
 * across unmount), NOT a component-bound mutation: the repo view unmounts when
 * the repo closes, and a probe in flight at that moment must still land its
 * result. `cancelled` only skips STARTING the second (network) probe — a value
 * already resolved is always persisted (it's keyed by its own repo's path, so
 * writing it after a repo switch is still correct, never a stale cross-repo
 * write). `persistRepoVisibility` is serialized against the other recentRepos
 * writers, so it can't lose an update.
 */
export function useRepoVisibilityProbe(repoPath: string | null) {
  const queryClient = useQueryClient();
  // biome-ignore lint/correctness/useExhaustiveDependencies: queryClient is stable; re-run only when the open path changes
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    const persist = async (visibility: string | null) => {
      await persistRepoVisibility([{ path: repoPath, visibility }]);
      queryClient.invalidateQueries({ queryKey: settingsKeys.settings });
    };
    (async () => {
      try {
        const [owner] = await gitRepoOwners([repoPath]);
        if (!owner?.provider) {
          await persist(null);
          return;
        }
        if (cancelled) return;
        const visibility = await forgeRepoVisibility(repoPath);
        await persist(visibility);
      } catch {
        // Ambient metadata — a failed probe leaves the persisted value alone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath]);
}
