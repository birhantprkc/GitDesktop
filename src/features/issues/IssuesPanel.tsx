import { Popover } from "@base-ui/react/popover";
import {
  CheckCircleIcon,
  CircleDashedIcon,
  FunnelIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { GhNotReady } from "@/features/repository/GhNotReady";
import type { IssueStateFilter } from "@/lib/git/api";
import {
  useGhStatus,
  useHoverPrefetch,
  useIssueList,
  usePrefetchIssue,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CreateIssueDialog } from "./CreateIssueDialog";

export function IssuesPanel({ repoPath }: { repoPath: string }) {
  const gh = useGhStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const [stateFilter, setStateFilter] = useState<IssueStateFilter>("open");
  const issueList = useIssueList(repoPath, ghReady, stateFilter);
  const selectedIssue = useUiStore((s) => s.selectedIssue);
  const selectIssue = useUiStore((s) => s.selectIssue);
  const prefetchIssue = usePrefetchIssue(repoPath);
  const hoverPrefetch = useHoverPrefetch();
  const [filterText, setFilterText] = useState("");
  const [authorFilter, setAuthorFilter] = useState<Set<string>>(new Set());
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useHotkeyAction("focus-filter", () => filterRef.current?.focus());
  useHotkeyAction("create-issue", () => setCreateOpen(true), ghReady);

  const issues = issueList.data ?? [];

  const authors = [
    ...new Set(issues.flatMap((i) => (i.author ? [i.author.login] : []))),
  ].sort();
  const labels = [
    ...new Set(issues.flatMap((i) => i.labels.map((l) => l.name))),
  ].sort();

  const query = filterText.trim().toLowerCase();

  const visible = issues.filter((issue) => {
    const author = issue.author?.login ?? "";
    if (
      query &&
      !issue.title.toLowerCase().includes(query) &&
      !`#${issue.number}`.includes(query) &&
      !author.toLowerCase().includes(query) &&
      !issue.labels.some((l) => l.name.toLowerCase().includes(query))
    ) {
      return false;
    }
    if (authorFilter.size > 0 && !authorFilter.has(author)) return false;
    if (
      labelFilter.size > 0 &&
      !issue.labels.some((l) => labelFilter.has(l.name))
    ) {
      return false;
    }
    return true;
  });

  const activeFilterCount = authorFilter.size + labelFilter.size;

  const navTargets = visible.map((i) => ({
    kind: "remote" as const,
    id: String(i.number),
  }));

  const onListKeyDown = listKeyboardNav({
    items: navTargets,
    activeIndex: navTargets.findIndex(
      (t) => selectedIssue?.kind === "remote" && t.id === selectedIssue.id,
    ),
    onActivate: (target) => selectIssue(target),
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

  const RowIcon = stateFilter === "open" ? CircleDashedIcon : CheckCircleIcon;

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
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={!ghReady}
          title={
            ghReady
              ? undefined
              : "Connect this repository to GitHub to open an issue."
          }
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
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
                      ({issues.filter((i) => i.author?.login === a).length})
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
                      {
                        issues.filter((i) => i.labels.some((x) => x.name === l))
                          .length
                      }
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
          {gh.isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
            </div>
          ) : !ghReady ? (
            <GhNotReady repoPath={repoPath} feature="issues" />
          ) : issueList.isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {issues.length > 0
                ? "No issues match the filter."
                : `No ${stateFilter} issues.`}
            </p>
          ) : (
            visible.map((issue) => {
              const active =
                selectedIssue?.kind === "remote" &&
                selectedIssue.id === String(issue.number);
              return (
                <button
                  type="button"
                  key={issue.number}
                  data-row={`remote:${issue.number}`}
                  className={cn(
                    "block w-full border-b px-3 py-2 text-left",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/60",
                  )}
                  onClick={() =>
                    selectIssue({ kind: "remote", id: String(issue.number) })
                  }
                  onMouseEnter={() =>
                    hoverPrefetch(() => prefetchIssue(issue.number))
                  }
                >
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <RowIcon className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{issue.title}</span>
                  </p>
                  <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
                    #{issue.number} ·{" "}
                    {issue.author ? `${issue.author.login} · ` : ""}
                    {formatRelativeTime(issue.createdAt)}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <CreateIssueDialog
        repoPath={repoPath}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
