import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanComposer } from "@/features/plan/PlanView";
import { type PlanSeed, usePlanStore } from "@/features/plan/store";
import { SessionComposer } from "./SessionComposer";
import { useSessionsStore } from "./store";

const EXAMPLES = [
  "Add input validation to the login form",
  "Write unit tests for the date utils",
  "Refactor this file into smaller components",
];

type Mode = "delegate" | "plan";

/**
 * The new-task state of the canvas (shown when nothing is selected): a calm,
 * centered panel with two modes — "Delegate a task" hands a write-capable agent a
 * job in an isolated worktree; "Plan a task" starts a read-only plan run that
 * explores the repo and drafts an agent-ready issue (no worktree, no writes).
 */
export function SessionActivation({ repoPath }: { repoPath: string }) {
  const [mode, setMode] = useState<Mode>("delegate");
  const [planSeed, setPlanSeed] = useState<PlanSeed | null>(null);
  // Bumped when a seed is consumed, so PlanComposer remounts and re-initializes
  // its fields from the new seed.
  const [seedNonce, setSeedNonce] = useState(0);

  const pendingTask = useSessionsStore((s) => s.pendingTask);
  const pendingPlanSeed = usePlanStore((s) => s.pendingPlanSeed);
  const setPendingPlanSeed = usePlanStore((s) => s.setPendingPlanSeed);

  // A handoff ("Implement this issue") seeds the Delegate composer.
  useEffect(() => {
    if (pendingTask) setMode("delegate");
  }, [pendingTask]);

  // The agent-plan hotkey or an issue's Plan button switches to (and seeds) the
  // Plan composer. Snapshot the seed locally so it survives clearing the store.
  useEffect(() => {
    if (!pendingPlanSeed) return;
    setMode("plan");
    setPlanSeed(pendingPlanSeed);
    setSeedNonce((n) => n + 1);
    setPendingPlanSeed(null);
  }, [pendingPlanSeed, setPendingPlanSeed]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-3 py-2.5">
        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode);
            // A manual tab switch starts a blank composer (a pending seed comes
            // in via the effect above, not through user interaction).
            setPlanSeed(null);
          }}
        >
          <TabsList>
            <TabsTrigger value="delegate">Delegate a task</TabsTrigger>
            <TabsTrigger value="plan">Plan a task</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {mode === "delegate" ? (
        // Docked like the conversation footer + VS Code: the welcome text floats
        // in the scrollable area above, the composer is pinned to the bottom edge,
        // so its toolbar never shifts as the textarea grows upward.
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
            <div className="flex max-w-md flex-col gap-2">
              <h2 className="text-base font-medium text-balance">
                Delegate a task to an agent
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The agent runs full-auto in an isolated worktree — your working
                tree, index, and branch are never touched. Review its changes
                and keep them when you're happy. Run several at once.
              </p>
            </div>
          </div>
          <div className="shrink-0 border-t p-2">
            <SessionComposer
              repoPath={repoPath}
              session={null}
              examples={EXAMPLES}
              autoFocus
            />
          </div>
        </div>
      ) : (
        <PlanComposer key={seedNonce} repoPath={repoPath} seed={planSeed} />
      )}
    </div>
  );
}
