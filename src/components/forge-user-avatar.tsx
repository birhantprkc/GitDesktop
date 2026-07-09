import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ForgeUserRef } from "@/lib/git/types";

/**
 * A forge user's avatar for picker rows, chips, and read-only lists (reviewers,
 * assignees). GitLab and Bitbucket supply a real `avatarUrl`, so we use it
 * directly; GitHub doesn't (its user `id` IS the login, and GitHub serves avatars
 * at `<host>/<login>.png`), so we derive it there — pass `ghHost` from
 * `useForgeGhHost(repoPath)`, which is `null` off GitHub. With neither — no URL and
 * off GitHub — the Avatar primitive falls back to the initial, keeping every
 * provider consistent. Mirrors `AuthorAvatar`'s fallback chain.
 */
export function ForgeUserAvatar({
  user,
  ghHost,
}: {
  user: ForgeUserRef;
  ghHost: string | null;
}) {
  const src =
    user.avatarUrl || (ghHost ? `https://${ghHost}/${user.id}.png?size=48` : "");
  return (
    <Avatar size="sm" className="shrink-0">
      {src && <AvatarImage src={src} alt={user.label} />}
      <AvatarFallback>
        {(user.label || "?").charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
