import { GithubLogoIcon, GitlabLogoIcon } from "@phosphor-icons/react";
import type { ForgeProvider } from "@/lib/git/types";
import { cn } from "@/lib/utils";

/**
 * The forge's brand mark, sized to sit inline alongside Phosphor icons. GitHub
 * and GitLab use the Phosphor logo glyphs; Bitbucket has no Phosphor icon, so
 * it's an inline single-path `currentColor` SVG (the simple-icons Bitbucket
 * mark) drawn on the same 24×24 viewBox Phosphor uses, so all three align.
 *
 * Shared component — future surfaces (clone dialog tabs, bot identity) reuse it.
 * `provider` is the neutral forge id; an unrecognized value renders nothing so
 * callers can hand it their raw resolved provider without pre-filtering.
 */
export function ProviderIcon({
  provider,
  className,
}: {
  provider: ForgeProvider | string | null | undefined;
  className?: string;
}) {
  if (provider === "github")
    return <GithubLogoIcon className={className} aria-hidden />;
  if (provider === "gitlab")
    return <GitlabLogoIcon className={className} aria-hidden />;
  if (provider === "bitbucket")
    return (
      <svg
        viewBox="0 0 24 24"
        className={cn("fill-current", className)}
        aria-hidden
        focusable="false"
      >
        <path d="M.778 1.211a.768.768 0 00-.768.892l3.263 19.811c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.528H9.522L8.17 8.464h7.561z" />
      </svg>
    );
  return null;
}
