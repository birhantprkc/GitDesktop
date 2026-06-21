import {
  ArrowsClockwiseIcon,
  BookBookmarkIcon,
  GitForkIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
import { useVirtualizer } from "@tanstack/react-virtual";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppForm } from "@/lib/form";
import { cloneRepo, validateRepo } from "@/lib/git/api";
import { useGhRepos } from "@/lib/git/queries";
import type { GhRepo } from "@/lib/git/types";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useAddRecentRepo, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { errorMessage, isAppError } from "@/lib/tauri/invoke";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Parent folder of a path, where a clone's subfolder gets created. */
function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx > 0 ? p.slice(0, idx) : "";
}

/** Repo name inferred from a clone URL, for the "will clone into" hint. */
function nameFromUrl(url: string): string {
  const last = url.trim().replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
  return last.replace(/\.git$/, "");
}

type CloneTab = "github" | "url";

/** A flat, virtualizer-friendly view of the owner-grouped repos. */
type Row = { kind: "header"; owner: string } | { kind: "repo"; repo: GhRepo };

const DEFAULTS = { url: "", destination: "" };

const REPO_LISTBOX_ID = "clone-repo-listbox";
/** Stable DOM id per repo row, so the filter's aria-activedescendant can point
 *  at the keyboard-highlighted option for screen readers. */
const repoOptionId = (nameWithOwner: string) =>
  `clone-repo-${nameWithOwner.replace(/[^\w-]/g, "_")}`;

export function CloneRepoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const openRepo = useUiStore((s) => s.openRepo);
  const addRecent = useAddRecentRepo();
  const settings = useSettings();

  // Tab, selection, and filter are UI state; the URL and local path are form
  // fields so submission and its spinner come from the form.
  const [tab, setTab] = useState<CloneTab>("github");
  const [selected, setSelected] = useState<GhRepo | null>(null);
  const [filter, setFilter] = useState("");

  const repos = useGhRepos(open && tab === "github");

  const form = useAppForm({
    defaultValues: DEFAULTS,
    onSubmit: async ({ value }) => {
      const dest = value.destination.trim();
      const cloneUrl =
        tab === "github" ? (selected?.cloneUrl ?? "") : value.url.trim();
      if (!cloneUrl || !dest) return;
      try {
        const clonedPath = await cloneRepo(
          cloneUrl,
          dest,
          tab === "github" ? selected?.name : undefined,
        );
        const info = await validateRepo(clonedPath);
        addRecent.mutate({ path: info.root, name: info.name });
        onOpenChange(false);
        openRepo(info);
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Default the destination near the user's other repos.
  const defaultPath = useEffectEvent(() => {
    const recent = settings.data?.recentRepos?.[0]?.path;
    return recent ? parentDir(recent) : "";
  });
  const seedOnOpen = useEffectEvent(() => {
    setTab("github");
    setSelected(null);
    setFilter("");
    form.reset(
      { url: "", destination: defaultPath() },
      { keepDefaultValues: true },
    );
  });
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  const values = useSelector(form.store, (s) => s.values);
  const isSubmitting = useSelector(form.store, (s) => s.isSubmitting);

  // Group by owner — the viewer's own repos first, then other owners
  // alphabetically — and flatten to rows for the virtualizer. Each group keeps
  // the API's newest-push-first order.
  const rows = useMemo<Row[]>(() => {
    const data = repos.data;
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    const matched = data.repos.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.nameWithOwner.toLowerCase().includes(q),
    );
    const byOwner = new Map<string, GhRepo[]>();
    for (const r of matched) {
      const list = byOwner.get(r.owner);
      if (list) list.push(r);
      else byOwner.set(r.owner, [r]);
    }
    const owners = [...byOwner.entries()].sort((a, b) => {
      if (a[0] === data.viewer) return -1;
      if (b[0] === data.viewer) return 1;
      return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
    });
    return owners.flatMap(([owner, list]): Row[] => [
      { kind: "header", owner },
      ...list.map((repo) => ({ kind: "repo" as const, repo })),
    ]);
  }, [repos.data, filter]);

  // Just the repo rows in display order, for arrow-key navigation.
  const repoRows = useMemo(
    () => rows.flatMap((r) => (r.kind === "repo" ? [r.repo] : [])),
    [rows],
  );

  // Drop a selection that the filter has hidden, so the Clone target always
  // matches what's on screen.
  useEffect(() => {
    if (
      selected &&
      !repoRows.some((r) => r.nameWithOwner === selected.nameWithOwner)
    ) {
      setSelected(null);
    }
  }, [repoRows, selected]);

  const onFilterKeyDown = listKeyboardNav({
    items: repoRows,
    activeIndex: repoRows.findIndex(
      (r) => r.nameWithOwner === selected?.nameWithOwner,
    ),
    onActivate: (r) => setSelected(r),
  });

  async function pickDestination() {
    const path = await openDialog({ directory: true, title: "Local path" });
    if (path) form.setFieldValue("destination", path);
  }

  const finalName =
    tab === "github" ? (selected?.name ?? "") : nameFromUrl(values.url);
  const canClone =
    values.destination.trim().length > 0 &&
    (tab === "github" ? selected !== null : values.url.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Clone a repository</DialogTitle>
            <DialogDescription>
              Pick one of your GitHub repositories or paste a URL. Clones over
              HTTPS or SSH using your system git credentials.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as CloneTab)}>
            <TabsList className="w-full">
              <TabsTrigger value="github" className="flex-1">
                GitHub.com
              </TabsTrigger>
              <TabsTrigger value="url" className="flex-1">
                URL
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "github" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={onFilterKeyDown}
                  placeholder="Filter your repositories"
                  aria-label="Filter your repositories"
                  role="combobox"
                  aria-expanded={repos.isSuccess}
                  aria-controls={REPO_LISTBOX_ID}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    selected ? repoOptionId(selected.nameWithOwner) : undefined
                  }
                  disabled={!repos.isSuccess}
                  className="h-8 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Refresh"
                  disabled={repos.isFetching}
                  onClick={() => repos.refetch()}
                >
                  {repos.isFetching ? <Spinner /> : <ArrowsClockwiseIcon />}
                </Button>
              </div>
              <div className="h-72 rounded-none border">
                <RepoBrowser
                  repos={repos}
                  rows={rows}
                  selected={selected}
                  onSelect={setSelected}
                  onUseUrl={() => setTab("url")}
                />
              </div>
            </div>
          ) : (
            <form.AppField name="url">
              {(field) => (
                <field.TextField
                  label="Repository URL or owner/name"
                  placeholder="https://github.com/user/repo.git"
                />
              )}
            </form.AppField>
          )}

          <div className="space-y-1.5">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <form.AppField name="destination">
                  {(field) => (
                    <field.TextField
                      label="Local path"
                      placeholder="Choose a folder to clone into…"
                    />
                  )}
                </form.AppField>
              </div>
              <Button type="button" variant="outline" onClick={pickDestination}>
                Choose…
              </Button>
            </div>
            {values.destination.trim() && finalName && (
              <p className="truncate text-[11px] text-muted-foreground">
                Clones into{" "}
                <span className="font-mono">
                  {values.destination.trim().replace(/[\\/]$/, "")}
                  {values.destination.includes("/") ? "/" : "\\"}
                  {finalName}
                </span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton disabled={!canClone}>Clone</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RepoBrowser({
  repos,
  rows,
  selected,
  onSelect,
  onUseUrl,
}: {
  repos: ReturnType<typeof useGhRepos>;
  rows: Row[];
  selected: GhRepo | null;
  onSelect: (repo: GhRepo) => void;
  onUseUrl: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i].kind === "header" ? 26 : 30),
    overscan: 12,
  });

  // Keep the keyboard-selected repo scrolled into view.
  const selectedKey = selected?.nameWithOwner;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the selection or list changes
  useEffect(() => {
    if (!selectedKey) return;
    const idx = rows.findIndex(
      (r) => r.kind === "repo" && r.repo.nameWithOwner === selectedKey,
    );
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [selectedKey, rows]);

  if (repos.isPending) {
    return (
      <div className="space-y-2 p-2">
        {["a", "b", "c", "d", "e"].map((k) => (
          <Skeleton key={k} className="h-7 w-full" />
        ))}
      </div>
    );
  }

  if (repos.isError) {
    const notFound =
      isAppError(repos.error) && repos.error.kind === "ghNotFound";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-xs font-medium">
          {notFound
            ? "GitHub CLI not found"
            : "Couldn't load your repositories"}
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {notFound
            ? "Install the GitHub CLI and run gh auth login to browse your repositories, or clone from a URL instead."
            : errorMessage(repos.error)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onUseUrl}>
          Clone from a URL
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No repositories match.
      </p>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      role="listbox"
      id={REPO_LISTBOX_ID}
      aria-label="Your repositories"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          return (
            <div
              key={v.key}
              data-index={v.index}
              ref={virtualizer.measureElement}
              // Presentation wrapper so the virtualizer's positioning div doesn't
              // sit between the listbox and its options in the a11y tree.
              role="presentation"
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${v.start}px)` }}
            >
              {row.kind === "header" ? (
                <p className="bg-muted/50 px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {row.owner}
                </p>
              ) : (
                <RepoRow
                  repo={row.repo}
                  active={selected?.nameWithOwner === row.repo.nameWithOwner}
                  onSelect={onSelect}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RepoRow({
  repo,
  active,
  onSelect,
}: {
  repo: GhRepo;
  active: boolean;
  onSelect: (repo: GhRepo) => void;
}) {
  const Icon = repo.private
    ? LockSimpleIcon
    : repo.fork
      ? GitForkIcon
      : BookBookmarkIcon;
  return (
    <button
      type="button"
      id={repoOptionId(repo.nameWithOwner)}
      role="option"
      aria-selected={active}
      onClick={() => onSelect(repo)}
      title={repo.description ?? repo.nameWithOwner}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{repo.name}</span>
      {repo.archived && (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          Archived
        </Badge>
      )}
    </button>
  );
}
