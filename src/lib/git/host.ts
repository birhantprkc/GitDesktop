import { useUiStore } from "@/lib/stores/ui";
import { useForgeStatus } from "./queries";

/**
 * The hosting host of the open repo — "github.com" or an Enterprise server like
 * "github.acme.com" — defaulting to github.com until it's known. Lets avatar
 * URLs, profile links, and gh-command hints resolve on the right host without
 * threading the host through every component. Reads the provider-neutral
 * `forge_status`, which carries the same host gh reports for a GitHub repo.
 */
export function useActiveGhHost(): string {
  const repoPath = useUiStore((s) => s.repoPath);
  const forge = useForgeStatus(repoPath ?? "");
  return forge.data?.host ?? "github.com";
}

/**
 * The GitHub host to derive login-based avatars from for a given repo, or `null`
 * when the repo isn't a GitHub one. GitHub serves avatars at `<host>/<login>.png`,
 * so a login is enough there; GitLab/Bitbucket have no login-derivable avatar URL,
 * so their users must carry a real `avatarUrl` (returning `null` here makes the
 * avatar fall back to the initial rather than a wrong github.com URL). Used by the
 * reviewer/assignee pickers and any `ForgeUserRef` avatar surface.
 */
export function useForgeGhHost(repoPath: string): string | null {
  const forge = useForgeStatus(repoPath);
  return forge.data?.provider === "github"
    ? forge.data.host || "github.com"
    : null;
}

/** Like {@link useForgeGhHost} but for the currently-open repo (the ui-store
 *  `repoPath`) — for surfaces like `AuthorAvatar` that carry only a login, not a
 *  repo path. `null` off GitHub so a login-derived avatar is only attempted where it
 *  resolves. */
export function useActiveForgeGhHost(): string | null {
  const repoPath = useUiStore((s) => s.repoPath);
  const forge = useForgeStatus(repoPath ?? "");
  return forge.data?.provider === "github"
    ? forge.data.host || "github.com"
    : null;
}
