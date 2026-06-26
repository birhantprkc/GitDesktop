import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { LabelChip } from "@/features/conversations/Thread";
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
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CreateDiscussionDialog } from "./CreateDiscussionDialog";

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
  const [createOpen, setCreateOpen] = useState(false);
  const pendingCreate = useUiStore((s) => s.pendingCreate);
  const clearPendingCreate = useUiStore((s) => s.clearPendingCreate);

  useHotkeyAction("focus-filter", () => filterRef.current?.focus());

  // Opened from the command palette / New menu via requestCreate (any tab).
  useEffect(() => {
    if (pendingCreate === "discussion") {
      setCreateOpen(true);
      clearPendingCreate();
    }
  }, [pendingCreate, clearPendingCreate]);

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
              <Button
                variant="outline"
                size="xs"
                disabled={!listEnabled}
                title={
                  listEnabled
                    ? undefined
                    : "Sign in to GitHub to browse discussions"
                }
              />
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
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={!listEnabled}
          title={
            listEnabled
              ? "New discussion"
              : "Sign in to GitHub to start a discussion"
          }
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon data-icon="inline-start" />
          New
        </Button>
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
                    "flex w-full items-start gap-2 border-b px-3 py-2 text-left",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/60",
                  )}
                  onClick={() => selectDiscussion({ number: d.number })}
                  onMouseEnter={() => hoverPrefetch(() => prefetch(d.number))}
                >
                  <Avatar size="sm" className="mt-0.5 shrink-0">
                    <AvatarImage
                      src={`https://github.com/${d.author}.png?size=48`}
                      alt={d.author}
                    />
                    <AvatarFallback>
                      {(d.author || "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <span aria-hidden className="shrink-0">
                        {d.categoryEmoji || "💬"}
                      </span>
                      <span className="truncate" title={d.title}>
                        {d.title}
                      </span>
                      {d.isAnswered && (
                        <Badge variant="secondary">answered</Badge>
                      )}
                    </p>
                    {d.labels.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {d.labels.map((l) => (
                          <LabelChip key={l.name} label={l} />
                        ))}
                      </div>
                    )}
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      #{d.number} · {d.author || "unknown"} · {d.categoryName}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {d.commentCount}{" "}
                      {d.commentCount === 1 ? "comment" : "comments"} ·{" "}
                      {formatRelativeTime(d.createdAt)}
                      {d.upvoteCount > 0 && (
                        <>
                          {" · "}
                          <span aria-hidden>▲ {d.upvoteCount}</span>
                          <span className="sr-only">
                            {d.upvoteCount}{" "}
                            {d.upvoteCount === 1 ? "upvote" : "upvotes"}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <CreateDiscussionDialog
        repoPath={repoPath}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
