import { useUiStore } from "@/lib/stores/ui";
import { useGhStatus } from "./queries";

/**
 * The GitHub host of the open repo — "github.com" or an Enterprise server like
 * "github.acme.com" — defaulting to github.com until it's known. Lets avatar
 * URLs, profile links, and gh-command hints resolve on the right host without
 * threading the host through every component. Reads the same cached
 * `gh_status` query the header already runs for the active repo.
 */
export function useActiveGhHost(): string {
  const repoPath = useUiStore((s) => s.repoPath);
  const gh = useGhStatus(repoPath ?? "");
  return gh.data?.host ?? "github.com";
}
