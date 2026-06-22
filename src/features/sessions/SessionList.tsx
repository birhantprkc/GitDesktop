import { PlusIcon, SparkleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { type AgentSession, useSessionsStore } from "./store";

/**
 * The agent-session list (sidebar): every concurrent session as a row with its
 * task and status, plus a New button. Selecting a row shows it in the main
 * canvas; New shows the composer. Each session runs in its own worktree, so one
 * can be working while you read another.
 */
export function SessionList() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const setActive = useSessionsStore((s) => s.setActive);

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
          onClick={() => setActive(null)}
        >
          <PlusIcon className="size-3.5" />
          New
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {sessions.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No sessions yet. Click <span className="font-medium">New</span> to
            delegate a task.
          </p>
        ) : (
          <div className="p-1">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === activeId}
                onClick={() => setActive(s.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function statusLabel(s: AgentSession): string {
  if (s.running) return "Working…";
  if (s.headHash !== s.base) return "Ready to review";
  return "No changes yet";
}

function SessionRow({
  session,
  active,
  onClick,
}: {
  session: AgentSession;
  active: boolean;
  onClick: () => void;
}) {
  const title = session.turns[0]?.prompt.trim() || "New session";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
    >
      <span className="line-clamp-1 w-full text-xs font-medium">{title}</span>
      <span className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
        {session.running && <Spinner className="size-3 shrink-0" />}
        {!session.running && session.headHash !== session.base && (
          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
        )}
        <span className="truncate">{statusLabel(session)}</span>
      </span>
    </button>
  );
}
