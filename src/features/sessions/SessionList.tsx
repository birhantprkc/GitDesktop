import { PlusIcon, SparkleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { cn } from "@/lib/utils";
import { StatusIndicator } from "./status";
import { type AgentSession, useSessionsStore } from "./store";

/**
 * The agent-session list (sidebar): every concurrent session as a row with its
 * task and status, plus a New button. Selecting a row shows it in the main
 * canvas; New shows the composer. Each session runs in its own worktree, so one
 * can be working while you read another. Arrow keys walk the rows.
 */
export function SessionList({ repoPath }: { repoPath: string }) {
  const allSessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);
  // Sessions belong to the repo they were started in.
  const sessions = allSessions.filter((s) => s.repoPath === repoPath);

  const newSession = () => setActive(null);
  useHotkeyAction("agent-new-session", newSession);

  const activeIndex = sessions.findIndex((s) => s.id === activeId);
  // When nothing is selected (the composer is showing), the first row is the
  // roving tab stop so Tab still reaches the list.
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
      {sessions.length === 0 ? (
        <EmptyState onNew={newSession} />
      ) : (
        <div
          role="listbox"
          aria-label="Agent sessions"
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto p-1"
        >
          {sessions.map((s, i) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeId}
              tabIndex={i === rovingIndex ? 0 : -1}
              onClick={() => setActive(s.id)}
            />
          ))}
        </div>
      )}
    </div>
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

function SessionRow({
  session,
  active,
  tabIndex,
  onClick,
}: {
  session: AgentSession;
  active: boolean;
  tabIndex: number;
  onClick: () => void;
}) {
  const title = session.turns[0]?.prompt.trim() || "New session";
  const cost = session.turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-row={session.id}
      tabIndex={tabIndex}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-start gap-1 px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
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
    </button>
  );
}
