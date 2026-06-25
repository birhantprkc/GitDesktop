import {
  MagnifyingGlassIcon,
  PlusIcon,
  SparkleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import {
  AnimatePresence,
  type MotionProps,
  m,
  useReducedMotion,
} from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type PlanRun, usePlanStore } from "@/features/plan/store";
import { useReconcileLocalPrs } from "@/features/pulls/useReconcileLocalPrs";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { type PrAudit, usePrAuditByBranch } from "@/lib/pulls/audit";
import { cn } from "@/lib/utils";
import { clearAgentSelection, selectPlan, selectSession } from "./agentSelect";
import { PrAuditChip } from "./PrAuditChip";
import { StatusIndicator, sessionStatus } from "./status";
import { type AgentSession, useSessionsStore } from "./store";

/** Which bucket the list shows: in-progress, finalized sessions, or implemented
 *  plans filed away as references. */
type SessionTab = "active" | "kept" | "archived";

/** A row in the unified list — a read-only plan run, or a write-capable session.
 *  Both share the agent surface; one is selected at a time. */
type NavRow = { kind: "plan"; id: string } | { kind: "session"; id: string };

/** Lowercased text a session search matches: the branch and every turn's prompt. */
function sessionHaystack(s: AgentSession): string {
  return [s.branch, ...s.turns.map((t) => t.prompt)].join(" \n ").toLowerCase();
}

/** Lowercased text a plan search matches: its prompt and the drafted plan. */
function planHaystack(r: PlanRun): string {
  return [r.origin?.goal, r.origin?.issueTitle, r.text]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
}

function planLabel(r: PlanRun): string {
  return r.origin?.issueTitle?.trim() || r.origin?.goal?.trim() || "Plan";
}

/**
 * The agent sidebar: read-only **plans** and write-capable **sessions** in one
 * list, each as a row with its task and status. Sessions split into **Active**
 * (working / ready to review) and **Kept** tabs; plans (always in-progress work)
 * sit above the active sessions. A search box finds one by task, branch, or
 * message. Selecting a row shows it in the canvas; New shows the composer. Arrow
 * keys walk the rows.
 */
export function SessionList({ repoPath }: { repoPath: string }) {
  const allSessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const allRuns = usePlanStore((s) => s.runs);
  const activePlanId = usePlanStore((s) => s.activePlanId);
  const setPendingPlanSeed = usePlanStore((s) => s.setPendingPlanSeed);

  const [tab, setTab] = useState<SessionTab>("active");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Plans and sessions belong to the repo they were started in.
  const repoSessions = useMemo(
    () => allSessions.filter((s) => s.repoPath === repoPath),
    [allSessions, repoPath],
  );
  const repoPlans = useMemo(
    () => allRuns.filter((r) => r.repoPath === repoPath),
    [allRuns, repoPath],
  );
  const activeSessionCount = useMemo(
    () => repoSessions.filter((s) => !s.kept).length,
    [repoSessions],
  );
  // A plan whose implementing session has been kept is "archived" — it moves to
  // the Kept tab (a finished reference) instead of cluttering Active. Derived, so
  // it stays in sync (and reverts if the session is later discarded).
  const keptSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of repoSessions) if (s.kept) ids.add(s.id);
    return ids;
  }, [repoSessions]);
  const archivedPlanCount = useMemo(
    () =>
      repoPlans.filter(
        (r) =>
          r.implementedSessionId && keptSessionIds.has(r.implementedSessionId),
      ).length,
    [repoPlans, keptSessionIds],
  );
  // Active = in-progress plans + working/ready sessions. Kept = finalized
  // sessions. Archived = implemented plans (kept references) in their own tab so
  // they don't crowd either.
  const activeCount =
    activeSessionCount + (repoPlans.length - archivedPlanCount);
  const keptCount = repoSessions.length - activeSessionCount;
  const archivedCount = archivedPlanCount;

  // Audit: link each session's branch to its pull request and merge state. Keep
  // local PRs honest with git while the agent tab is open, then look up by branch
  // (local + GitHub). Remote PRs are only fetched once something's been kept —
  // before that, no session has a PR to show.
  useReconcileLocalPrs(repoPath);
  const prAudit = usePrAuditByBranch(repoPath, keptCount > 0);

  // The visible rows: the current tab, narrowed by the search query. Sessions show
  // on Active (working) / Kept (finalized); plans show on Active (in-progress) /
  // Archived (implemented).
  const sessions = useMemo(() => {
    if (tab === "archived") return [];
    const q = query.trim().toLowerCase();
    return repoSessions.filter(
      (s) =>
        s.kept === (tab === "kept") && (!q || sessionHaystack(s).includes(q)),
    );
  }, [repoSessions, tab, query]);
  const plans = useMemo(() => {
    if (tab === "kept") return [];
    const q = query.trim().toLowerCase();
    const archived = (r: PlanRun) =>
      Boolean(
        r.implementedSessionId && keptSessionIds.has(r.implementedSessionId),
      );
    return repoPlans.filter(
      (r) =>
        archived(r) === (tab === "archived") &&
        (!q || planHaystack(r).includes(q)),
    );
  }, [repoPlans, tab, query, keptSessionIds]);

  const newSession = () => clearAgentSelection();
  const openPlanComposer = () => {
    clearAgentSelection();
    setPendingPlanSeed({});
  };
  useHotkeyAction("agent-new-session", newSession);
  useHotkeyAction("agent-plan", openPlanComposer);
  useHotkeyAction("agent-toggle-list-tab", () =>
    setTab((t) =>
      t === "active" ? "kept" : t === "kept" ? "archived" : "active",
    ),
  );
  useHotkeyAction("focus-filter", () => searchRef.current?.focus());

  // The Archived tab only exists while there are archived plans; if it empties
  // (e.g. its session was discarded) while you're on it, fall back to Active.
  useEffect(() => {
    if (tab === "archived" && archivedCount === 0) setTab("active");
  }, [tab, archivedCount]);

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

  // One flat navigation order: plans first, then sessions.
  const navItems = useMemo<NavRow[]>(
    () => [
      ...plans.map((r) => ({ kind: "plan" as const, id: r.id })),
      ...sessions.map((s) => ({ kind: "session" as const, id: s.id })),
    ],
    [plans, sessions],
  );
  const activeIndex = navItems.findIndex((it) =>
    it.kind === "plan" ? it.id === activePlanId : it.id === activeId,
  );
  // When nothing in this list is selected, the first row is the roving tab stop.
  const rovingIndex = activeIndex === -1 ? 0 : activeIndex;
  const onKeyDown = listKeyboardNav({
    items: navItems,
    activeIndex,
    rowKey: (it) => it.id,
    onActivate: (it) =>
      it.kind === "plan" ? selectPlan(it.id) : selectSession(it.id),
  });

  const nothingSelected = activeId === null && activePlanId === null;
  const repoEmpty = repoSessions.length === 0 && repoPlans.length === 0;
  const showGroups = plans.length > 0 && sessions.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-2 pl-3">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <SparkleIcon className="size-4 text-primary" />
          Agent
        </span>
        <Button
          size="xs"
          variant={nothingSelected ? "secondary" : "ghost"}
          className="ml-auto"
          onClick={newSession}
        >
          <PlusIcon className="size-3.5" />
          New
        </Button>
      </div>
      {repoEmpty ? (
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
                {archivedCount > 0 && (
                  <TabsTrigger value="archived" className="min-w-0 flex-1">
                    Archived
                    <Count n={archivedCount} />
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search plans & sessions"
                aria-label="Search agent plans and sessions"
                autoComplete="off"
                className="h-7 pl-7"
              />
            </div>
          </div>
          {navItems.length === 0 ? (
            <ListEmpty tab={tab} hasQuery={query.trim().length > 0} />
          ) : (
            <div
              role="listbox"
              aria-label="Agent plans and sessions"
              onKeyDown={onKeyDown}
              className="min-h-0 flex-1 overflow-y-auto p-1"
            >
              {/* Keyed by tab so switching tabs is an instant swap; within a tab,
                  add/remove animates. */}
              <AnimatePresence key={tab} initial={false}>
                {showGroups && <GroupLabel key="g-plans">Plans</GroupLabel>}
                {plans.map((r, i) => (
                  <PlanRow
                    key={`plan:${r.id}`}
                    run={r}
                    audit={prAudit}
                    active={r.id === activePlanId}
                    tabIndex={i === rovingIndex ? 0 : -1}
                    motionProps={rowMotion}
                    onClick={() => selectPlan(r.id)}
                  />
                ))}
                {showGroups && (
                  <GroupLabel key="g-sessions">Sessions</GroupLabel>
                )}
                {sessions.map((s, j) => {
                  const idx = plans.length + j;
                  return (
                    <SessionRow
                      key={`session:${s.id}`}
                      session={s}
                      audit={prAudit.get(s.branch)}
                      active={s.id === activeId}
                      tabIndex={idx === rovingIndex ? 0 : -1}
                      motionProps={rowMotion}
                      onClick={() => selectSession(s.id)}
                    />
                  );
                })}
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

/** A group divider label (decorative — the rows carry the meaning, so it's hidden
 *  from assistive tech, which reads the options in order). */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      aria-hidden
      className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground"
    >
      {children}
    </p>
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
          before keeping — or plan one first, read-only.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onNew}>
        <PlusIcon className="size-3.5" />
        New
      </Button>
    </div>
  );
}

/** Shown when a tab (or a search within it) has no rows, but other rows exist —
 *  so the full empty state with its New button would be misleading. */
function ListEmpty({ tab, hasQuery }: { tab: SessionTab; hasQuery: boolean }) {
  const message = hasQuery
    ? "Nothing matches your search."
    : tab === "kept"
      ? "No kept sessions yet. Keep a session to file it here."
      : tab === "archived"
        ? "No archived plans yet. Plans land here once their session is kept."
        : "Nothing active — start a plan or session with New.";
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

/** Status line for a plan row — mirrors a session's StatusIndicator. */
function PlanStatus({
  run,
  audit,
}: {
  run: PlanRun;
  audit: Map<string, PrAudit>;
}) {
  // Subscribe to the spawned session (if any) so the row tracks its status live.
  const session = useSessionsStore((s) =>
    run.implementedSessionId
      ? s.sessions.find((x) => x.id === run.implementedSessionId)
      : undefined,
  );

  if (run.generating) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
        Planning…
      </span>
    );
  }
  // Once implemented, mirror the spawned session's status instead of "Plan ready".
  if (session) {
    const st = sessionStatus(session);
    if (st.kind === "working") {
      return (
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          Implementing…
        </span>
      );
    }
    if (st.kind === "error") {
      return <span className="text-destructive">Implement failed</span>;
    }
    // Audit trail: once the implementing session has a pull request, surface it
    // (its merge is the real "done") instead of the redundant "Kept".
    const merge = audit.get(session.branch);
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span className="truncate">
          {merge ? "Implemented" : `Implemented · ${st.label}`}
        </span>
        {merge && <PrAuditChip audit={merge} />}
      </span>
    );
  }
  if (run.error) return <span className="text-destructive">Plan failed</span>;
  if (run.draft)
    return <span className="text-muted-foreground">Plan ready</span>;
  return <span className="text-muted-foreground">Read-only plan</span>;
}

function PlanRow({
  run,
  audit,
  active,
  tabIndex,
  motionProps,
  onClick,
}: {
  run: PlanRun;
  audit: Map<string, PrAudit>;
  active: boolean;
  tabIndex: number;
  motionProps: Pick<MotionProps, "initial" | "animate" | "exit">;
  onClick: () => void;
}) {
  return (
    <m.button
      {...motionProps}
      type="button"
      role="option"
      aria-selected={active}
      data-row={run.id}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-start gap-1 overflow-hidden px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <span className="line-clamp-2 w-full text-xs font-medium leading-snug">
        {planLabel(run)}
      </span>
      <span className="flex w-full items-center gap-2 text-[11px]">
        <PlanStatus run={run} audit={audit} />
        {run.costUsd != null && (
          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
            ${run.costUsd.toFixed(2)}
          </span>
        )}
      </span>
    </m.button>
  );
}

function SessionRow({
  session,
  audit,
  active,
  tabIndex,
  motionProps,
  onClick,
}: {
  session: AgentSession;
  audit: PrAudit | undefined;
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
        {session.ensembleId && (
          <span
            className="inline-flex shrink-0 items-center text-muted-foreground"
            title="One arm of a best-of-N ensemble"
          >
            <UsersThreeIcon className="size-3.5" />
          </span>
        )}
        {audit && <PrAuditChip audit={audit} />}
        {cost > 0 && (
          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
            ${cost.toFixed(2)}
          </span>
        )}
      </span>
    </m.button>
  );
}
