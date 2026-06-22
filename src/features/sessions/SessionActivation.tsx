import { SparkleIcon } from "@phosphor-icons/react";
import { SessionComposer } from "./SessionComposer";

const EXAMPLES = [
  "Add input validation to the login form",
  "Write unit tests for the date utils",
  "Refactor this file into smaller components",
];

/**
 * The new-session state of the canvas (shown when no session is selected): a
 * calm, centered "delegate a task" panel. The composer is the focal point; the
 * copy reassures that the agent is sandboxed in a worktree.
 */
export function SessionActivation({ repoPath }: { repoPath: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b p-3 text-sm font-medium">
        <SparkleIcon className="size-4 text-primary" />
        New session
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="flex w-full max-w-xl flex-col gap-5">
          <div className="flex flex-col gap-2 text-center">
            <h2 className="text-base font-medium text-balance">
              Delegate a task to an agent
            </h2>
            <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
              The agent runs full-auto in an isolated worktree — your working
              tree, index, and branch are never touched. Review its changes and
              keep them when you're happy. Run several at once.
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
    </div>
  );
}
