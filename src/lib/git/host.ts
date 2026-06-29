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
