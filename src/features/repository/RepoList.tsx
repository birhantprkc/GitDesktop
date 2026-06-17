import { FolderIcon, XIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/clipboard";
import {
  ghRepoUrl,
  openInTerminal,
  openWithDefault,
  openWithProgram,
} from "@/lib/git/api";
import { useRepoOwners } from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { type RecentRepo, repoDisplayName } from "@/lib/settings/api";
import { useSettings } from "@/lib/settings/queries";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useOpenRepoByPath } from "./useOpenRepoByPath";

const RECENT_COUNT = 5;
const OTHER_GROUP = "Other";

/**
 * Filterable list of every repo GitDesktop has opened — a "Recent" shortcut
 * section plus all repos grouped by owner (from each repo's origin remote).
 * Used by the welcome screen and the in-app repo switcher; both render the
 * alias/remove dialogs themselves (the switcher's popover would unmount
 * dialogs nested in here).
 *
 * Keyboard-first: the filter autofocuses; ArrowUp/Down move a highlight
 * through the visible rows and Enter opens the highlighted repo (or the
 * first match when filtering).
 */
export function RepoList({
  currentPath,
  onOpened,
  onAliasRepo,
  onRemoveRepo,
}: {
  currentPath?: string | null;
  onOpened?: () => void;
  onAliasRepo: (repo: RecentRepo) => void;
  onRemoveRepo: (repo: RecentRepo) => void;
}) {
  const settings = useSettings();
  const recents = settings.data?.recentRepos ?? [];
  const owners = useRepoOwners(recents.map((r) => r.path));
  const open = useOpenRepoByPath();
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // On the welcome screen "show repositories" means "jump to the filter";
  // inside the switcher popover this list is only mounted while open, so
  // its registration simply outranks the trigger's while visible.
  useHotkeyAction("show-repositories", () => filterInputRef.current?.focus());
  useHotkeyAction("focus-filter", () => filterInputRef.current?.focus());

  const ownerByPath = new Map(
    (owners.data ?? []).map((o) => [o.path, o.owner]),
  );

  const q = filter.trim().toLowerCase();
  const filtered = recents.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      (r.alias ?? "").toLowerCase().includes(q) ||
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

  // Flattened render order, for arrow-key navigation.
  const visible = [
    ...recent,
    ...groupNames.flatMap((name) => groups.get(name) ?? []),
  ];
  const highlightedPath = visible[highlight]?.path ?? null;

  // Keep the keyboard highlight in view as it moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls to whichever row carries the current highlight
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  async function handleOpen(path: string) {
    setOpeningPath(path);
    try {
      await open(path);
      onOpened?.();
    } finally {
      setOpeningPath(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      // Open the highlighted repo, or the first match of a typed filter.
      // Plain Enter with no highlight and no filter does nothing, so an
      // accidental keypress never opens a repo.
      const target = visible[highlight] ?? (q ? visible[0] : undefined);
      if (target && !openingPath) handleOpen(target.path);
    }
  }

  const sectionProps = {
    currentPath: currentPath ?? null,
    highlightedPath,
    openingPath,
    ownerOf: (path: string) => ownerByPath.get(path) ?? null,
    onOpen: handleOpen,
    onAlias: onAliasRepo,
    onRemove: onRemoveRepo,
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 p-2">
        <Input
          // the filter is the keyboard entry point of this surface
          autoFocus
          ref={filterInputRef}
          autoComplete="off"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setHighlight(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Filter repositories"
          aria-label="Filter repositories"
          className="h-7"
        />
      </div>
      <ScrollArea
        className="min-h-0 **:data-[slot=scroll-area-viewport]:max-h-96"
        ref={listRef}
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {recents.length === 0
              ? "No repositories yet."
              : "No repositories match."}
          </p>
        ) : (
          <>
            <RepoSection title="Recent" repos={recent} {...sectionProps} />
            {groupNames.map((name) => (
              <RepoSection
                key={name}
                title={name}
                repos={groups.get(name) ?? []}
                {...sectionProps}
              />
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  );
}

interface RepoRowsProps {
  currentPath: string | null;
  highlightedPath: string | null;
  openingPath: string | null;
  ownerOf: (path: string) => string | null;
  onOpen: (path: string) => void;
  onAlias: (repo: RecentRepo) => void;
  onRemove: (repo: RecentRepo) => void;
}

function RepoSection({
  title,
  repos,
  ...rowProps
}: RepoRowsProps & { title: string; repos: RecentRepo[] }) {
  if (repos.length === 0) return null;
  return (
    <div>
      <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      {repos.map((r) => (
        <RepoRow key={`${title}:${r.path}`} repo={r} {...rowProps} />
      ))}
    </div>
  );
}

function RepoRow({
  repo,
  currentPath,
  highlightedPath,
  openingPath,
  ownerOf,
  onOpen,
  onAlias,
  onRemove,
}: RepoRowsProps & { repo: RecentRepo }) {
  const settings = useSettings();
  const highlighted = repo.path === highlightedPath;
  const opening = repo.path === openingPath;
  const owner = ownerOf(repo.path);
  const editor = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || "editor";

  function openWeb() {
    ghRepoUrl(repo.path)
      .then((url) => openUrl(url))
      .catch(toastError);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            data-highlighted={highlighted || undefined}
            className={cn(
              "group flex items-center",
              currentPath === repo.path
                ? "bg-accent text-accent-foreground"
                : highlighted
                  ? "bg-muted"
                  : "hover:bg-muted/60",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
              onClick={() => onOpen(repo.path)}
              disabled={openingPath !== null}
            >
              {opening ? (
                <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-xs",
                    repo.alias && "italic",
                  )}
                  title={repo.alias ? repo.name : undefined}
                >
                  {repoDisplayName(repo)}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {repo.path}
                </span>
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${repoDisplayName(repo)}`}
              className="mr-1 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onRemove(repo)}
            >
              <XIcon />
            </Button>
          </div>
        }
      />
      <ContextMenuContent className="min-w-52">
        <ContextMenuItem onClick={() => onAlias(repo)}>
          {repo.alias ? "Change alias…" : "Create alias…"}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => copyText(repo.name, "Repository name copied")}
        >
          Copy repo name
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => copyText(repo.path, "Repository path copied")}
        >
          Copy repo path
        </ContextMenuItem>
        <ContextMenuSeparator />
        {owner && (
          <ContextMenuItem onClick={openWeb}>View on GitHub</ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() =>
            openInTerminal(
              repo.path,
              settings.data?.terminal,
              settings.data?.terminalPath,
            ).catch(toastError)
          }
        >
          Open in terminal
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => openWithDefault(repo.path).catch(toastError)}
        >
          Show in Explorer
        </ContextMenuItem>
        {editor && (
          <ContextMenuItem
            onClick={() => openWithProgram(editor, repo.path).catch(toastError)}
          >
            Open in {editorName}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onRemove(repo)}>
          Remove…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
