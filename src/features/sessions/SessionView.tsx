import { SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BranchDiffView } from "@/features/compare/BranchDiffView";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { SessionChat } from "./SessionChat";
import { type AgentSession, useSessionsStore } from "./store";

/**
 * The agent "canvas": the active session's conversation on the left and the
 * cumulative diff of its work (`base..HEAD`, refreshed after each turn's
 * checkpoint commit) on the right, with Keep / Discard. When no session is
 * selected, the chat column shows the new-session composer.
 */
export function SessionView({ repoPath }: { repoPath: string }) {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  // Only adopt the active session if it belongs to this repo (activeId is
  // global; switching repos shows the new-session composer until you pick one).
  const active =
    sessions.find((s) => s.id === activeId && s.repoPath === repoPath) ?? null;

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-h-0 w-[22rem] shrink-0 flex-col border-r">
        <SessionChat
          key={active?.id ?? "new"}
          session={active}
          repoPath={repoPath}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <SessionDiff session={active} />
        ) : (
          <DiffPlaceholder
            icon={SparkleIcon}
            message="Start an agent session to see its changes here"
          />
        )}
      </div>
    </div>
  );
}

function SessionDiff({ session }: { session: AgentSession }) {
  const busyId = useSessionsStore((s) => s.busyId);
  const keep = useSessionsStore((s) => s.keep);
  const discard = useSessionsStore((s) => s.discard);
  const [squash, setSquash] = useState(true);

  const hasCommits = session.headHash !== session.base;
  const commitCount = session.turns.filter((t) => t.commitHash).length;
  const blocked = session.running || busyId === session.id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">Agent's changes</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {session.branch}
          </div>
        </div>
        {commitCount > 1 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={squash}
              onChange={(e) => setSquash(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Squash {commitCount} commits
          </label>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={blocked}
          onClick={() => discard(session.id)}
        >
          Discard
        </Button>
        <Button
          size="sm"
          disabled={blocked || !hasCommits}
          onClick={() => keep(session.id, squash)}
        >
          Keep
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {hasCommits ? (
          <BranchDiffView
            repoPath={session.worktreePath}
            base={session.base}
            compare={session.headHash}
          />
        ) : (
          <DiffPlaceholder
            icon={SparkleIcon}
            message={
              session.running
                ? "The agent is working…"
                : "No changes yet — send the agent a task."
            }
          />
        )}
      </div>
    </div>
  );
}
