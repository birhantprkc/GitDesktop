import { SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BranchDiffView } from "@/features/compare/BranchDiffView";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { useSessionsStore } from "./store";

/**
 * The main pane for an agent session: the cumulative diff of everything the
 * agent has done so far (the worktree's `base..HEAD`, refreshed after each
 * turn's checkpoint commit), with Keep / Discard. Keep optionally squashes the
 * per-turn commits into one; Discard removes the worktree and its branch.
 */
export function SessionView() {
  const session = useSessionsStore((s) => s.session);
  const busy = useSessionsStore((s) => s.busy);
  const running = useSessionsStore((s) => s.running);
  const keep = useSessionsStore((s) => s.keep);
  const discard = useSessionsStore((s) => s.discard);
  const [squash, setSquash] = useState(true);

  if (!session) {
    return (
      <DiffPlaceholder
        icon={SparkleIcon}
        message="Start an agent session to see its changes here"
      />
    );
  }

  const hasCommits = session.headHash !== session.base;
  const commitCount = session.turns.filter((t) => t.commitHash).length;
  const blocked = busy || running;

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
          onClick={discard}
        >
          Discard
        </Button>
        <Button
          size="sm"
          disabled={blocked || !hasCommits}
          onClick={() => keep(squash)}
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
              running
                ? "The agent is working…"
                : "No changes yet — send the agent a task."
            }
          />
        )}
      </div>
    </div>
  );
}
