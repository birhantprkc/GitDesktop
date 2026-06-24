import {
  MagnifyingGlassIcon,
  PlusIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import {
  AnimatePresence,
  type MotionProps,
  m,
  useReducedMotion,
} from "motion/react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePlanStore } from "@/features/plan/store";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { cn } from "@/lib/utils";
import { StatusIndicator } from "./status";
import { type AgentSession, useSessionsStore } from "./store";

/** Which bucket the list shows: in-progress / ready-to-review vs. filed-away. */
type SessionTab = "active" | "kept";

/** Lowercased text a search query matches against: the title, the branch, and
 *  every turn's prompt (so a session is findable by a later message too). */
function sessionHaystack(s: AgentSession): string {
  return [s.branch, ...s.turns.map((t) => t.prompt)].join(" \n ").toLowerCase();
}

/**
 * The agent-session list (sidebar): every concurrent session as a row with its
 * task and status, split into **Active** (working / ready to review) and
 * **Kept** tabs so finalized sessions don't crowd the ones awaiting review, with
 * a search box to find one by task, branch, or message. Selecting a row shows it
 * in the main canvas; New shows the composer. Each session runs in its own
 * worktree, so one can be working while you read another. Arrow keys walk the
 * rows.
 */
export function SessionList({ repoPath }: { repoPath: string }) {
  const allSessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActiveSession = useSessionsStore((s) => s.setActive);
  const planClose = usePlanStore((s) => s.close);
  // Selecting a session (or "New") leaves the plan canvas if it's open — the two
  // share the agent surface and are mutually exclusive.
  const setActive = (id: string | null) => {
    planClose();
    setActiveSession(id);
  };

  const [tab, setTab] = useState<SessionTab>("active");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Sessions belong to the repo they were started in.
  const repoSessions = useMemo(
    () => allSessions.filter((s) => s.repoPath === repoPath),
    [allSessions, repoPath],
  );
  const activeCount = useMemo(
    () => repoSessions.filter((s) => !s.kept).length,
    [repoSessions],
  );
  const keptCount = repoSessions.length - activeCount;

  // The visible list: the current tab, narrowed by the search query.
  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repoSessions.filter(
      (s) =>
        s.kept === (tab === "kept") && (!q || sessionHaystack(s).includes(q)),
    );
  }, [repoSessions, tab, query]);

  const newSession = () => setActive(null);
  const planOpen = usePlanStore((s) => s.open);
  useHotkeyAction("agent-new-session", newSession);
  useHotkeyAction("agent-plan", () => planOpen(repoPath));
  useHotkeyAction("agent-toggle-list-tab", () =>
    setTab((t) => (t === "active" ? "kept" : "active")),
  );
  useHotkeyAction("focus-filter", () => searchRef.current?.focus());

  // Rows fade + collapse on add/remove so the list reflows calmly. Reduced
  // motion → opacity only (no height motion). py-2 (8px) is mirrored here because
  // motion owns the row's vertical padding while it collapses to nothing.
  const reduce = useReducedMotion();
  const rowMotion: Pick<MotionProps, "initial" | "animate" | "exit"> = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 },
        animate: {
          opacity: 1,
          height: "auto",
          paddingTop: 8,
          paddingBottom: 8,
        },
        exit: { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 },
      };

  const activeIndex = sessions.findIndex((s) => s.id === activeId);
  // When nothing in this list is selected, the first row is the roving tab stop
  // so Tab still reaches the list.
  const rovingIndex = activeIndex === -1 ? 0 : activeIndex;
  const onKeyDown = listKeyboardNav({
    items: sessions,
    activeIndex,
    rowKey: (s) => s.id,
    onActivate: (s) => setActive(s.id),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-2 pl-3">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <SparkleIcon className="size-4 text-primary" />
          Agent sessions
        </span>
        <Button
          size="xs"
          variant={activeId === null ? "secondary" : "ghost"}
          className="ml-auto"
          onClick={newSession}
        >
          <PlusIcon className="size-3.5" />
          New
        </Button>
      </div>
      {repoSessions.length === 0 ? (
        <EmptyState onNew={newSession} />
      ) : (
        <>
          <div className="shrink-0 space-y-2 border-b p-2">
            <Tabs value={tab} onValueChange={(v) => setTab(v as SessionTab)}>
              <TabsList className="w-full">
                <TabsTrigger value="active" className="min-w-0 flex-1">
                  Active
                  <Count n={activeCount} />
                </TabsTrigger>
                <TabsTrigger value="kept" className="min-w-0 flex-1">
                  Kept
                  <Count n={keptCount} />
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sessions"
                aria-label="Search agent sessions"
                autoComplete="off"
                className="h-7 pl-7"
              />
            </div>
          </div>
          {sessions.length === 0 ? (
            <ListEmpty tab={tab} hasQuery={query.trim().length > 0} />
          ) : (
            <div
              role="listbox"
              aria-label="Agent sessions"
              onKeyDown={onKeyDown}
              className="min-h-0 flex-1 overflow-y-auto p-1"
            >
              {/* Keyed by tab so switching tabs is an instant swap (no per-row
                  exit flurry); within a tab, add/remove animates. */}
              <AnimatePresence key={tab} initial={false}>
                {sessions.map((s, i) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === activeId}
                    tabIndex={i === rovingIndex ? 0 : -1}
                    motionProps={rowMotion}
                    onClick={() => setActive(s.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A small count beside a tab label (decorative — the label carries meaning). */
function Count({ n }: { n: number }) {
  return (
    <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">
      {n}
    </span>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <SparkleIcon className="size-7 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-xs font-medium">No agent sessions yet</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Delegate a task and the agent works in an isolated worktree you review
          before keeping.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onNew}>
        <PlusIcon className="size-3.5" />
        New session
      </Button>
    </div>
  );
}

/** Shown when a tab (or a search within it) has no rows, but other sessions
 *  exist — so the full empty state with its New button would be misleading. */
function ListEmpty({ tab, hasQuery }: { tab: SessionTab; hasQuery: boolean }) {
  const message = hasQuery
    ? "No sessions match your search."
    : tab === "kept"
      ? "No kept sessions yet. Keep a session to file it here."
      : "No active sessions — start one with New.";
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

function SessionRow({
  session,
  active,
  tabIndex,
  motionProps,
  onClick,
}: {
  session: AgentSession;
  active: boolean;
  tabIndex: number;
  motionProps: Pick<MotionProps, "initial" | "animate" | "exit">;
  onClick: () => void;
}) {
  const title = session.turns[0]?.prompt.trim() || "New session";
  const cost = session.turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
  return (
    <m.button
      {...motionProps}
      type="button"
      role="option"
      aria-selected={active}
      data-row={session.id}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-start gap-1 overflow-hidden px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <span className="line-clamp-2 w-full text-xs font-medium leading-snug">
        {title}
      </span>
      <span className="flex w-full items-center gap-2 text-[11px]">
        <StatusIndicator session={session} className="min-w-0" />
        {cost > 0 && (
          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
            ${cost.toFixed(2)}
          </span>
        )}
      </span>
    </m.button>
  );
}
