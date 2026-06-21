import {
  CaretDownIcon,
  GitPullRequestIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ConversationFilterPopover } from "@/features/conversations/ConversationFilterPopover";
import { useLocalRemoteFilter } from "@/features/conversations/useLocalRemoteFilter";
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
  const filterRef = useRef<HTMLInputElement>(null);
  const {
    filterText,
    setFilterText,
    authorFilter,
    labelFilter,
    toggle,
    showArchived,
    setShowArchived,
    authors,
    labels,
    activeFilterCount,
    stateLocal,
    stateRemote,
    visibleLocal,
    archivedLocalCount,
    visibleRemote,
    authorCount,
    labelCount,
  } = useLocalRemoteFilter({
    locals: localPrs.data ?? [],
    remotes: prList.data ?? [],
    stateFilter,
  });

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
        <ConversationFilterPopover
          authors={authors}
          labels={labels}
          authorFilter={authorFilter}
          labelFilter={labelFilter}
          toggle={toggle}
          activeFilterCount={activeFilterCount}
          authorCount={authorCount}
          labelCount={labelCount}
        />
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
                    <span className="truncate" title={pr.title}>
                      {pr.title}
                    </span>
                    {pr.status !== "open" && (
                      <Badge variant="secondary" className="capitalize">
                        {pr.status}
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
                    {pr.head} → {pr.base}
                    {pr.archived ? " · archived" : ""}
                  </p>
                </button>
              );
            })
          )}
          {archivedLocalCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="px-3 py-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {showArchived
                ? "Hide archived"
                : `Show archived (${archivedLocalCount})`}
            </button>
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
                    <span className="truncate" title={pr.title}>
                      {pr.title}
                    </span>
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
