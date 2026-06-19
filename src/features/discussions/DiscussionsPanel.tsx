import { CaretDownIcon } from "@phosphor-icons/react";
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
import { GhNotReady } from "@/features/repository/GhNotReady";
import {
  useDiscussionList,
  useDiscussionMeta,
  useGhStatus,
  useHoverPrefetch,
  usePrefetchDiscussion,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

export function DiscussionsPanel({ repoPath }: { repoPath: string }) {
  const gh = useGhStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const meta = useDiscussionMeta(repoPath, ghReady);
  const enabled = meta.data?.hasDiscussionsEnabled ?? false;
  const listEnabled = ghReady && enabled;
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const list = useDiscussionList(repoPath, listEnabled, categoryId);
  const selectedDiscussion = useUiStore((s) => s.selectedDiscussion);
  const selectDiscussion = useUiStore((s) => s.selectDiscussion);
  const prefetch = usePrefetchDiscussion(repoPath);
  const hoverPrefetch = useHoverPrefetch();
  const [filterText, setFilterText] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  useHotkeyAction("focus-filter", () => filterRef.current?.focus());

  const categories = meta.data?.categories ?? [];
  const activeCat = categories.find((c) => c.id === categoryId);
  const discussions = list.data ?? [];
  const query = filterText.trim().toLowerCase();

  const visible = discussions.filter(
    (d) =>
      !query ||
      d.title.toLowerCase().includes(query) ||
      `#${d.number}`.includes(query) ||
      d.author.toLowerCase().includes(query) ||
      d.categoryName.toLowerCase().includes(query),
  );

  const navTargets = visible.map((d) => ({ number: d.number }));
  const onListKeyDown = listKeyboardNav({
    items: navTargets,
    activeIndex: navTargets.findIndex(
      (t) => t.number === selectedDiscussion?.number,
    ),
    onActivate: (t) => selectDiscussion(t),
    rowKey: (t) => String(t.number),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="xs" disabled={!listEnabled} />
            }
          >
            {activeCat
              ? `${activeCat.emoji ? `${activeCat.emoji} ` : ""}${activeCat.name}`
              : "All categories"}
            <CaretDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            <DropdownMenuItem
              onClick={() => setCategoryId(null)}
              className={cn(
                categoryId === null && "bg-accent text-accent-foreground",
              )}
            >
              All categories
            </DropdownMenuItem>
            {categories.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={cn(
                  categoryId === c.id && "bg-accent text-accent-foreground",
                )}
              >
                {c.emoji ? `${c.emoji} ` : ""}
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="border-b p-2">
        <Input
          ref={filterRef}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Search by title, #, author, or category"
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
            <GhNotReady repoPath={repoPath} feature="discussions" />
          ) : meta.isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
            </div>
          ) : meta.isError ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Couldn't load discussions for this repository.
            </p>
          ) : !enabled ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Discussions aren't enabled for this repository.
            </p>
          ) : list.isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {discussions.length > 0
                ? "No discussions match the filter."
                : "No discussions yet."}
            </p>
          ) : (
            visible.map((d) => {
              const active = selectedDiscussion?.number === d.number;
              return (
                <button
                  type="button"
                  key={d.number}
                  data-row={String(d.number)}
                  className={cn(
                    "block w-full border-b px-3 py-2 text-left",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/60",
                  )}
                  onClick={() => selectDiscussion({ number: d.number })}
                  onMouseEnter={() => hoverPrefetch(() => prefetch(d.number))}
                >
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <span aria-hidden className="shrink-0">
                      {d.categoryEmoji || "💬"}
                    </span>
                    <span className="truncate">{d.title}</span>
                    {d.isAnswered && (
                      <Badge variant="secondary">answered</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate pl-5 text-[11px] text-muted-foreground">
                    #{d.number} · {d.author ? `${d.author} · ` : ""}
                    {d.categoryName} · {d.commentCount}{" "}
                    {d.commentCount === 1 ? "comment" : "comments"}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
