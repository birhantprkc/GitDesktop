import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { botLoginName } from "@/lib/git/bot-login";
import { useBotAvatarUrl } from "@/lib/git/queries";
import type { ForgeUserRef } from "@/lib/git/types";
import { cn } from "@/lib/utils";

/**
 * The canonical forge-user avatar for picker rows, chips, and read-only lists
 * (reviewers, assignees, collaborators, members, conversation authors). GitLab and
 * Bitbucket supply a real `avatarUrl`, so we use it directly; GitHub doesn't (its
 * user `id`/login IS the handle, and GitHub serves avatars at `<host>/<login>.png`),
 * so we derive it there — pass `ghHost` from `useForgeGhHost(repoPath)` (or the
 * active-repo hooks), which is `null` off GitHub. With neither — no URL and off
 * GitHub — the Avatar primitive falls back to the initial, keeping every provider
 * consistent. This is the single home for the user-avatar initials fallback.
 *
 * GitHub **bots** are the exception: the login-derived `.png` doesn't exist for
 * bot accounts (`github.com/app/dependabot.png` 404s), so a bot handle is resolved
 * to its real avatar via the API once and cached ({@link useBotAvatarUrl}); github.com
 * only, so Enterprise bots keep the initials fallback.
 *
 * Callers with a full `ForgeUserRef` pass `user`; callers with a bare login (plus an
 * optional real avatar URL) pass `login`/`avatarUrl`.
 */
export function ForgeUserAvatar({
  user,
  login,
  avatarUrl,
  ghHost = null,
  size = "sm",
  className,
  decorative = false,
}: {
  /** A full forge user reference (id + label + avatarUrl). */
  user?: ForgeUserRef;
  /** A bare login, when the caller has no `ForgeUserRef`. Ignored if `user` is set. */
  login?: string;
  /** The provider's real avatar URL, when known and no `user` is passed. */
  avatarUrl?: string;
  /** GitHub host for login-derived avatars; `null`/omitted off GitHub. */
  ghHost?: string | null;
  size?: "sm" | "default" | "lg";
  className?: string;
  /** Hide the whole avatar from assistive tech when the login is shown as adjacent
   *  text — otherwise a screen reader announces the fallback letter before the name. */
  decorative?: boolean;
}) {
  // Normalize the two calling shapes into a single handle + label + real URL.
  const handle = user?.id ?? login ?? "";
  const label = user?.label ?? login ?? "";
  const realUrl = user?.avatarUrl ?? avatarUrl ?? "";
  // A bot handle only needs an API lookup when there's no real URL and we're on
  // GitHub — the login-derived `.png` below doesn't exist for bots. Hooks can't
  // be conditional, so `useBotAvatarUrl(null)` stays disabled (no fetch) on the
  // common non-bot / off-GitHub path — cheap in the large picker lists this renders in.
  const bot = realUrl || !ghHost ? null : botLoginName(handle);
  const botAvatar = useBotAvatarUrl(bot);
  const src = realUrl
    ? realUrl
    : bot !== null
      ? // A bot: the resolved URL, or "" while loading/failed → initials fallback.
        (botAvatar.data ?? "")
      : ghHost
        ? `https://${ghHost}/${handle}.png?size=48`
        : "";
  return (
    <Avatar
      aria-hidden={decorative || undefined}
      size={size}
      className={cn("shrink-0", className)}
    >
      {src && <AvatarImage src={src} alt={decorative ? "" : label} />}
      <AvatarFallback>{(label || "?").charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
