import { FolderIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRepoOwners } from "@/lib/git/queries";
import type { RecentRepo } from "@/lib/settings/api";
import { useRemoveRecentRepo, useSettings } from "@/lib/settings/queries";
import { cn } from "@/lib/utils";
import { useOpenRepoByPath } from "./useOpenRepoByPath";

const RECENT_COUNT = 5;
const OTHER_GROUP = "Other";

/**
 * Filterable list of every repo GitDesktop has opened — a "Recent" shortcut
 * section plus all repos grouped by owner (from each repo's origin remote).
 * Used by the welcome screen and the in-app repo switcher.
 */
export function RepoList({
  currentPath,
  onOpened,
}: {
  currentPath?: string | null;
  onOpened?: () => void;
}) {
  const settings = useSettings();
  const recents = settings.data?.recentRepos ?? [];
  const owners = useRepoOwners(recents.map((r) => r.path));
  const open = useOpenRepoByPath();
  const removeRecent = useRemoveRecentRepo();
  const [filter, setFilter] = useState("");

  const ownerByPath = new Map(
    (owners.data ?? []).map((o) => [o.path, o.owner]),
  );

  const q = filter.trim().toLowerCase();
  const filtered = recents.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q) ||
      (ownerByPath.get(r.path) ?? "").toLowerCase().includes(q),
  );

  // Recent shortcut (only when not filtering). Excluded from the owner groups
  // below so a repo is never listed twice.
  const recent = q ? [] : filtered.slice(0, RECENT_COUNT);
  const recentPaths = new Set(recent.map((r) => r.path));

  // Group the remaining repos by owner; "Other" (no remote) sorts last.
  const groups = new Map<string, RecentRepo[]>();
  for (const r of filtered) {
    if (recentPaths.has(r.path)) continue;
    const owner = ownerByPath.get(r.path) || OTHER_GROUP;
    const list = groups.get(owner);
    if (list) list.push(r);
    else groups.set(owner, [r]);
  }
  const groupNames = [...groups.keys()].sort((a, b) => {
    if (a === OTHER_GROUP) return 1;
    if (b === OTHER_GROUP) return -1;
    return a.localeCompare(b);
  });

  async function handleOpen(path: string) {
    await open(path);
    onOpened?.();
  }

  function Row({ repo }: { repo: RecentRepo }) {
    return (
      <div
        className={cn(
          "group flex items-center",
          currentPath === repo.path
            ? "bg-accent text-accent-foreground"
            : "hover:bg-muted/60",
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
          onClick={() => handleOpen(repo.path)}
        >
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs">{repo.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {repo.path}
            </span>
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${repo.name} from the list`}
          className="mr-1 shrink-0 opacity-0 group-hover:opacity-100"
          onClick={() => removeRecent.mutate(repo.path)}
        >
          <XIcon />
        </Button>
      </div>
    );
  }

  function Section({ title, repos }: { title: string; repos: RecentRepo[] }) {
    if (repos.length === 0) return null;
    return (
      <div>
        <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </p>
        {repos.map((r) => (
          <Row key={`${title}:${r.path}`} repo={r} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 p-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter repositories"
          className="h-7"
        />
      </div>
      <ScrollArea className="max-h-96 min-h-0 flex-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {recents.length === 0
              ? "No repositories yet."
              : "No repositories match."}
          </p>
        ) : (
          <>
            <Section title="Recent" repos={recent} />
            {groupNames.map((name) => (
              <Section key={name} title={name} repos={groups.get(name) ?? []} />
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
