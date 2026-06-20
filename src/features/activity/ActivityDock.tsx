import {
  CaretUpIcon,
  CheckCircleIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  SparkleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  cancelReview,
  dismissReview,
  type ReviewPhase,
  type ReviewTask,
  useReviewTasks,
} from "@/lib/stores/reviews";
import { useUiStore } from "@/lib/stores/ui";

function summarize(tasks: ReviewTask[]) {
  const running = tasks.filter((t) => t.phase === "running").length;
  const failed = tasks.filter((t) => t.phase === "error").length;
  const summary =
    running > 0
      ? `${running} running`
      : failed > 0
        ? `${failed} failed`
        : `${tasks.length} ready`;
  return { running, failed, summary };
}

/**
 * AI-review "running tasks" surface. The run state lives in the review store
 * (not a component), so it survives navigating away from a PR; these two
 * surfaces just render it without a noisy persistent toast. Both are invisible
 * while nothing is happening:
 *
 * - {@link ActivityDock} docks into the repo header (where most reviews are
 *   watched), so it never floats over content.
 * - {@link ActivityStrip} is a thin bottom bar for the screens with no header
 *   (welcome / settings / help), so a running review is still reachable there.
 */
export function ActivityDock() {
  const tasks = useReviewTasks();
  const [open, setOpen] = useState(false);

  // Collapse once everything's gone, so a later run doesn't reopen the popover.
  useEffect(() => {
    if (tasks.length === 0 && open) setOpen(false);
  }, [tasks.length, open]);

  if (tasks.length === 0) return null;

  const { running, failed, summary } = summarize(tasks);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex h-7 items-center gap-1 rounded-none px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground"
        aria-label={`AI activity: ${summary}. Open the list.`}
        title={`AI activity: ${summary}`}
      >
        <TriggerIcon running={running} failed={failed} />
        <span className="font-medium tabular-nums">{tasks.length}</span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-80 gap-0 p-0"
      >
        <ActivityList tasks={tasks} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

export function ActivityStrip() {
  const view = useUiStore((s) => s.view);
  const tasks = useReviewTasks();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (tasks.length === 0 && open) setOpen(false);
  }, [tasks.length, open]);

  // The header dock already covers the repo view; the strip only fills in for
  // the headerless screens. Nothing to show otherwise.
  if (view === "repo" || tasks.length === 0) return null;

  const { running, failed, summary } = summarize(tasks);

  return (
    <div className="flex h-7 shrink-0 items-center border-t bg-background px-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="inline-flex h-6 items-center gap-1.5 rounded-none px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground"
          aria-label={`AI activity: ${summary}. Open the list.`}
        >
          <TriggerIcon running={running} failed={failed} />
          <span className="font-medium">{summary}</span>
          <CaretUpIcon className="size-3" />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-80 gap-0 p-0"
        >
          <ActivityList tasks={tasks} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TriggerIcon({ running, failed }: { running: number; failed: number }) {
  if (running > 0) return <Spinner className="size-4" />;
  if (failed > 0)
    return (
      <WarningCircleIcon className="size-4 text-amber-500" weight="fill" />
    );
  return <CheckCircleIcon className="size-4 text-emerald-500" weight="fill" />;
}

/** The expandable task list shared by both surfaces. */
function ActivityList({
  tasks,
  onClose,
}: {
  tasks: ReviewTask[];
  onClose: () => void;
}) {
  const repoPath = useUiStore((s) => s.repoPath);
  const openPrReview = useUiStore((s) => s.openPrReview);
  const running = tasks.filter((t) => t.phase === "running").length;
  const finished = tasks.filter((t) => t.phase !== "running");

  return (
    <>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">Activity</span>
        {finished.length > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              for (const t of finished) dismissReview(t.key);
            }}
          >
            Clear finished
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {running} running
          </span>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto">
        {tasks.map((task) => (
          <TaskRow
            key={task.key}
            task={task}
            crossRepo={task.target.repoPath !== repoPath}
            onView={() => {
              openPrReview(task.target);
              onClose();
            }}
          />
        ))}
      </div>
    </>
  );
}

function TaskRow({
  task,
  crossRepo,
  onView,
}: {
  task: ReviewTask;
  crossRepo: boolean;
  onView: () => void;
}) {
  const ModeIcon = task.mode === "security" ? ShieldCheckIcon : SparkleIcon;
  const modeName = task.mode === "security" ? "Security audit" : "Review";
  const stateWord =
    task.phase === "running"
      ? task.status.trim() || "Running…"
      : task.phase === "error"
        ? "Failed"
        : task.phase === "cancelled"
          ? "Cancelled"
          : "Ready";

  return (
    <div className="flex items-start gap-2 px-3 py-2 not-last:border-b">
      <ModeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={task.title}>
          {task.title || "Pull request"}
        </p>
        <p
          className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"
          title={task.phase === "error" ? task.error : undefined}
        >
          <StateGlyph phase={task.phase} />
          <span className="truncate">
            {modeName} · {stateWord}
            {crossRepo ? ` · ${task.target.repoName}` : ""}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {task.phase === "running" ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => cancelReview(task.key)}
          >
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="xs" onClick={onView}>
              View
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss"
              onClick={() => dismissReview(task.key)}
            >
              <XIcon />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Phase glyph for a task — shape (paired with the adjacent word) carries the
 *  meaning, so it never relies on color alone. */
function StateGlyph({ phase }: { phase: ReviewPhase }) {
  switch (phase) {
    case "running":
      return <Spinner className="size-3 shrink-0" />;
    case "error":
      return (
        <WarningCircleIcon
          className="size-3 shrink-0 text-amber-500"
          weight="fill"
        />
      );
    case "cancelled":
      return <ProhibitIcon className="size-3 shrink-0" />;
    default:
      return (
        <CheckCircleIcon
          className="size-3 shrink-0 text-emerald-500"
          weight="fill"
        />
      );
  }
}
