import { Popover } from "@base-ui/react/popover";
import {
  CaretDownIcon,
  FunnelIcon,
  GitPullRequestIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { GhNotReady } from "@/features/repository/GhNotReady";
import type { PrStateFilter } from "@/lib/git/api";
import {
  useGhStatus,
  useHoverPrefetch,
  usePrefetchPr,
  usePrList,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import type { LocalPr } from "@/lib/pulls/local";
import { useLocalPrs } from "@/lib/pulls/queries";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { CreateLocalPrDialog } from "./CreateLocalPrDialog";
import { CreatePrDialog } from "./CreatePrDialog";
import { useReconcileLocalPrs } from "./useReconcileLocalPrs";

export function PullRequestsPanel({ repoPath }: { repoPath: string }) {
  const gh = useGhStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  // "closed" matches GitHub's Closed tab: closed and merged PRs alike.
  const [stateFilter, setStateFilter] = useState<PrStateFilter>("open");
  const prList = usePrList(repoPath, ghReady, stateFilter);
  const localPrs = useLocalPrs(repoPath);
  // Mark local PRs merged when their branch was merged outside the app.
  useReconcileLocalPrs(repoPath);
  const selectedPr = useUiStore((s) => s.selectedPr);
  const selectPr = useUiStore((s) => s.selectPr);
  const prefetchPr = usePrefetchPr(repoPath);
  const hoverPrefetch = useHoverPrefetch();
  const [createOpen, setCreateOpen] = useState(false);
  const [ghCreateOpen, setGhCreateOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [authorFilter, setAuthorFilter] = useState<Set<string>>(new Set());
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLInputElement>(null);

  // The dialog picks the head/base branches itself (so main → staging works
  // just as well as feature → main), so the only requirement here is that the
  // repo is actually on GitHub.
  const ghCreateReason = ghReady
    ? null
    : "Connect this repository to GitHub to open a pull request here.";
  const canCreateGhPr = ghReady;

  useHotkeyAction("focus-filter", () => filterRef.current?.focus());
  useHotkeyAction("create-local-pr", () => setCreateOpen(true));
  useHotkeyAction("create-pr", () => setGhCreateOpen(true), canCreateGhPr);

  const stateLocal = (localPrs.data ?? []).filter((p) =>
    stateFilter === "open" ? p.status === "open" : p.status !== "open",
  );
  const stateRemote = prList.data ?? [];

  // Filter options come from everything in the current state tab.
  const authors = [
    ...new Set(stateRemote.flatMap((p) => (p.author ? [p.author.login] : []))),
  ].sort();
  const labels = [
    ...new Set([
      ...stateRemote.flatMap((p) => p.labels.map((l) => l.name)),
      ...stateLocal.flatMap((p) => p.labels),
    ]),
  ].sort();

  const query = filterText.trim().toLowerCase();

  function matchesLocal(pr: LocalPr): boolean {
    if (
      query &&
      !pr.title.toLowerCase().includes(query) &&
      !pr.labels.some((l) => l.toLowerCase().includes(query))
    ) {
      return false;
    }
    // Local PRs have no GitHub author — an author filter excludes them.
    if (authorFilter.size > 0) return false;
    if (labelFilter.size > 0 && !pr.labels.some((l) => labelFilter.has(l))) {
      return false;
    }
    return true;
  }

  const visibleLocal = stateLocal.filter(matchesLocal);
  const visibleRemote = stateRemote.filter((pr) => {
    const author = pr.author?.login ?? "";
    if (
      query &&
      !pr.title.toLowerCase().includes(query) &&
      !`#${pr.number}`.includes(query) &&
      !author.toLowerCase().includes(query) &&
      !pr.labels.some((l) => l.name.toLowerCase().includes(query))
    ) {
      return false;
    }
    if (authorFilter.size > 0 && !authorFilter.has(author)) return false;
    if (
      labelFilter.size > 0 &&
      !pr.labels.some((l) => labelFilter.has(l.name))
    ) {
      return false;
    }
    return true;
  });

  const activeFilterCount = authorFilter.size + labelFilter.size;

  // Arrow keys walk the visible rows, local section first like the list.
  const navTargets = [
    ...visibleLocal.map((pr) => ({ kind: "local" as const, id: pr.id })),
    ...visibleRemote.map((pr) => ({
      kind: "remote" as const,
      id: String(pr.number),
    })),
  ];

  const onListKeyDown = listKeyboardNav({
    items: navTargets,
    activeIndex: navTargets.findIndex(
      (t) => t.kind === selectedPr?.kind && t.id === selectedPr.id,
    ),
    onActivate: (target) => selectPr(target),
    rowKey: (target) => `${target.kind}:${target.id}`,
  });

  function toggle(
    set: Set<string>,
    update: (next: Set<string>) => void,
    value: string,
    on: boolean,
  ) {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    update(next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b p-2">
        {(["open", "closed"] as const).map((s) => (
          <Button
            key={s}
            variant={stateFilter === s ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={stateFilter === s}
            onClick={() => setStateFilter(s)}
          >
            {s === "open" ? "Open" : "Closed"}
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="xs" className="ml-auto">
                <PlusIcon data-icon="inline-start" />
                New
                <CaretDownIcon data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem
              disabled={!canCreateGhPr}
              title={ghCreateReason ?? undefined}
              onClick={() => setGhCreateOpen(true)}
            >
              Pull request on GitHub…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              Local pull request…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover.Root>
          <Popover.Trigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={
                  activeFilterCount > 0
                    ? `Filter by author or label (${activeFilterCount} active)`
                    : "Filter by author or label"
                }
                className="relative"
              />
            }
          >
            <FunnelIcon />
            {activeFilterCount > 0 && (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center bg-primary text-[9px] font-medium text-primary-foreground tabular-nums"
              >
                {activeFilterCount}
              </span>
            )}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              align="end"
              sideOffset={4}
              className="isolate z-50"
            >
              <Popover.Popup className="w-60 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                <p className="px-1 pb-1.5 text-xs font-medium">Author</p>
                {authors.length === 0 && (
                  <p className="px-1 pb-1 text-xs text-muted-foreground">
                    No authors to filter by.
                  </p>
                )}
                {authors.map((a) => (
                  <label
                    key={a}
                    className="flex cursor-pointer items-center gap-2 rounded-none px-1 py-1.5 text-xs hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={authorFilter.has(a)}
                      onCheckedChange={(v) =>
                        toggle(authorFilter, setAuthorFilter, a, v === true)
                      }
                    />
                    <span className="flex-1 truncate">{a}</span>
                    <span className="text-muted-foreground">
                      ({stateRemote.filter((p) => p.author?.login === a).length}
                      )
                    </span>
                  </label>
                ))}
                <p className="px-1 pt-2 pb-1.5 text-xs font-medium">Label</p>
                {labels.length === 0 && (
                  <p className="px-1 pb-1 text-xs text-muted-foreground">
                    No labels to filter by.
                  </p>
                )}
                {labels.map((l) => (
                  <label
                    key={l}
                    className="flex cursor-pointer items-center gap-2 rounded-none px-1 py-1.5 text-xs hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={labelFilter.has(l)}
                      onCheckedChange={(v) =>
                        toggle(labelFilter, setLabelFilter, l, v === true)
                      }
                    />
                    <span className="flex-1 truncate">{l}</span>
                    <span className="text-muted-foreground">
                      (
                      {stateRemote.filter((p) =>
                        p.labels.some((x) => x.name === l),
                      ).length +
                        stateLocal.filter((p) => p.labels.includes(l)).length}
                      )
                    </span>
                  </label>
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <div className="border-b p-2">
        <Input
          ref={filterRef}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search by title, #, author, or label"
          className="h-7"
          autoComplete="off"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div onKeyDown={onListKeyDown}>
          <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">Local</p>
          {visibleLocal.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {stateLocal.length > 0
                ? "No local pull requests match the filter."
                : `No ${stateFilter} local pull requests.`}
            </p>
          ) : (
            visibleLocal.map((pr) => {
              const active =
                selectedPr?.kind === "local" && selectedPr.id === pr.id;
              return (
                <button
                  type="button"
                  key={pr.id}
                  data-row={`local:${pr.id}`}
                  className={cn(
                    "block w-full border-b px-3 py-2 text-left",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/60",
                  )}
                  onClick={() => selectPr({ kind: "local", id: pr.id })}
                >
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <GitPullRequestIcon className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{pr.title}</span>
                    {pr.status !== "open" && (
                      <Badge variant="secondary" className="capitalize">
                        {pr.status}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
                    {pr.head} → {pr.base}
                  </p>
                </button>
              );
            })
          )}

          <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground">GitHub</p>
          {gh.isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
            </div>
          ) : !ghReady ? (
            <GhNotReady repoPath={repoPath} feature="pull requests" />
          ) : prList.isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : visibleRemote.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {stateRemote.length > 0
                ? "No pull requests match the filter."
                : `No ${stateFilter} pull requests.`}
            </p>
          ) : (
            visibleRemote.map((pr) => {
              const active =
                selectedPr?.kind === "remote" &&
                selectedPr.id === String(pr.number);
              return (
                <button
                  type="button"
                  key={pr.number}
                  data-row={`remote:${pr.number}`}
                  className={cn(
                    "block w-full border-b px-3 py-2 text-left",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/60",
                  )}
                  onClick={() =>
                    selectPr({ kind: "remote", id: String(pr.number) })
                  }
                  onMouseEnter={() =>
                    hoverPrefetch(() => prefetchPr(pr.number))
                  }
                >
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <GitPullRequestIcon className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{pr.title}</span>
                    {pr.isDraft && <Badge variant="secondary">draft</Badge>}
                    {pr.state !== "OPEN" && (
                      <Badge variant="secondary" className="capitalize">
                        {pr.state.toLowerCase()}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
                    #{pr.number} · {pr.author ? `${pr.author.login} · ` : ""}
                    {pr.headRefName} → {pr.baseRefName}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <CreateLocalPrDialog
        repoPath={repoPath}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <CreatePrDialog
        repoPath={repoPath}
        open={ghCreateOpen}
        onOpenChange={setGhCreateOpen}
      />
    </div>
  );
}
