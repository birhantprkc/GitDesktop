import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanComposer } from "@/features/plan/PlanView";
import { SessionComposer } from "./SessionComposer";

const EXAMPLES = [
  "Add input validation to the login form",
  "Write unit tests for the date utils",
  "Refactor this file into smaller components",
];

type Mode = "delegate" | "plan";

/**
 * The new-session state of the canvas (shown when no session is selected): a
 * calm, centered panel with two modes — "Delegate a task" hands a write-capable
 * agent a job in an isolated worktree; "Plan a task" runs a read-only agent that
 * explores the repo and drafts an agent-ready issue (no worktree, no writes).
 */
export function SessionActivation({ repoPath }: { repoPath: string }) {
  const [mode, setMode] = useState<Mode>("delegate");

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-3 py-2.5">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="delegate">Delegate a task</TabsTrigger>
            <TabsTrigger value="plan">Plan a task</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {mode === "delegate" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="flex w-full max-w-xl flex-col gap-5">
            <div className="flex flex-col gap-2 text-center">
              <h2 className="text-base font-medium text-balance">
                Delegate a task to an agent
              </h2>
              <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                The agent runs full-auto in an isolated worktree — your working
                tree, index, and branch are never touched. Review its changes
                and keep them when you're happy. Run several at once.
              </p>
            </div>
            <div className="border p-3">
              <SessionComposer
                repoPath={repoPath}
                session={null}
                examples={EXAMPLES}
                autoFocus
              />
            </div>
          </div>
        </div>
      ) : (
        <PlanComposer repoPath={repoPath} seed={null} />
      )}
    </div>
  );
}
