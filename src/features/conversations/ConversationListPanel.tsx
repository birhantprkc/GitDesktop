import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import type { KeyboardEventHandler, ReactNode, Ref } from "react";
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
import { GhNotReady } from "@/features/repository/GhNotReady";
import { cn } from "@/lib/utils";

/** The "New ▾" dropdown's two items (GitHub + local). */
export interface NewMenuConfig {
  ghLabel: string;
  ghDisabled: boolean;
  ghReason?: string;
  onGh: () => void;
  localLabel: string;
  onLocal: () => void;
}

const ROW_CLASS = "block w-full border-b px-3 py-2 text-left";
function rowClass(active: boolean) {
  return cn(
    ROW_CLASS,
    active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
  );
}

/**
 * The master-detail list scaffold shared by the PR and issue panels: a state
 * tab toolbar + New menu + filter slot, a search input, and a Local / GitHub
 * two-section list with the GitHub-ready/pending ladder. The row button chrome
 * (and thus the `data-row` keys arrow-key nav depends on) is baked in here; each
 * panel supplies only the inner row content via render props.
 */
export function ConversationListPanel<L, R>(props: {
  repoPath: string;
  /** GhNotReady's `feature` (e.g. "pull requests"). */
  feature: string;
  // toolbar
  stateFilter: "open" | "closed";
  onStateFilter: (s: "open" | "closed") => void;
  newMenu: NewMenuConfig;
  filterSlot: ReactNode;
  // search
  filterRef: Ref<HTMLInputElement>;
  filterText: string;
  onFilterText: (s: string) => void;
  // keyboard nav over the whole list
  onListKeyDown: KeyboardEventHandler;
  // local section
  stateLocal: L[];
  visibleLocal: L[];
  localKey: (item: L) => string;
  isLocalActive: (item: L) => boolean;
  onSelectLocal: (item: L) => void;
  renderLocalRow: (item: L) => ReactNode;
  archivedLocalCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  // remote (GitHub) section
  ghPending: boolean;
  ghReady: boolean;
  listPending: boolean;
  stateRemote: R[];
  visibleRemote: R[];
  remoteKey: (item: R) => string;
  isRemoteActive: (item: R) => boolean;
  onSelectRemote: (item: R) => void;
  onRemoteHover: (item: R) => void;
  renderRemoteRow: (item: R) => ReactNode;
  /** Skeleton rows while the GitHub list loads (PR=2, issue=3). */
  remoteSkeletonRows: number;
  // empty-state nouns
  localNoun: string;
  remoteNoun: string;
  /** Create dialogs etc. rendered after the list. */
  children?: ReactNode;
}) {
  const {
    stateFilter,
    onStateFilter,
    newMenu,
    filterSlot,
    filterRef,
    filterText,
    onFilterText,
    onListKeyDown,
    stateLocal,
    visibleLocal,
    localKey,
    isLocalActive,
    onSelectLocal,
    renderLocalRow,
    archivedLocalCount,
    showArchived,
    onToggleArchived,
    ghPending,
    ghReady,
    listPending,
    repoPath,
    feature,
    stateRemote,
    visibleRemote,
    remoteKey,
    isRemoteActive,
    onSelectRemote,
    onRemoteHover,
    renderRemoteRow,
    remoteSkeletonRows,
    localNoun,
    remoteNoun,
    children,
  } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b p-2">
        {(["open", "closed"] as const).map((s) => (
          <Button
            key={s}
            variant={stateFilter === s ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={stateFilter === s}
            onClick={() => onStateFilter(s)}
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
              disabled={newMenu.ghDisabled}
              title={newMenu.ghReason}
              onClick={newMenu.onGh}
            >
              {newMenu.ghLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={newMenu.onLocal}>
              {newMenu.localLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {filterSlot}
      </div>
      <div className="border-b p-2">
        <Input
          ref={filterRef}
          value={filterText}
          onChange={(e) => onFilterText(e.target.value)}
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
                ? `No local ${localNoun} match the filter.`
                : `No ${stateFilter} local ${localNoun}.`}
            </p>
          ) : (
            visibleLocal.map((item) => (
              <button
                type="button"
                key={localKey(item)}
                data-row={`local:${localKey(item)}`}
                className={rowClass(isLocalActive(item))}
                onClick={() => onSelectLocal(item)}
              >
                {renderLocalRow(item)}
              </button>
            ))
          )}
          {archivedLocalCount > 0 && (
            <button
              type="button"
              onClick={onToggleArchived}
              className="px-3 py-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {showArchived
                ? "Hide archived"
                : `Show archived (${archivedLocalCount})`}
            </button>
          )}

          <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground">GitHub</p>
          {ghPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
            </div>
          ) : !ghReady ? (
            <GhNotReady repoPath={repoPath} feature={feature} />
          ) : listPending ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: remoteSkeletonRows }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : visibleRemote.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {stateRemote.length > 0
                ? `No ${remoteNoun} match the filter.`
                : `No ${stateFilter} ${remoteNoun}.`}
            </p>
          ) : (
            visibleRemote.map((item) => (
              <button
                type="button"
                key={remoteKey(item)}
                data-row={`remote:${remoteKey(item)}`}
                className={rowClass(isRemoteActive(item))}
                onClick={() => onSelectRemote(item)}
                onMouseEnter={() => onRemoteHover(item)}
              >
                {renderRemoteRow(item)}
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      {children}
    </div>
  );
}
