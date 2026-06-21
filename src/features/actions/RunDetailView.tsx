import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  ProhibitIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { RunJob } from "@/lib/github/actions";
import {
  isRunActive,
  useCancelRun,
  useJobLogs,
  useRerunRun,
  useRunDetail,
  useRunFailedLogs,
} from "@/lib/github/actions";
import { useAiEnabled } from "@/lib/settings/queries";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { DebugJobDialog } from "./DebugJobDialog";
import { isFailureConclusion, StatusIcon, statusLabel } from "./status";

/** "1m 12s" elapsed between two ISO timestamps (now if not yet finished). */
function duration(start: string, end: string): string {
  if (!start) return "";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "";
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function JobRow({
  repoPath,
  job,
  onDebug,
}: {
  repoPath: string;
  job: RunJob;
  onDebug?: () => void;
}) {
  // Failed and in-progress jobs are the interesting ones — open them by default.
  const [open, setOpen] = useState(
    isRunActive(job.status) || isFailureConclusion(job.conclusion),
  );
  const [showLogs, setShowLogs] = useState(false);
  const logs = useJobLogs(repoPath, job.id, open && showLogs);
  const elapsed = duration(job.startedAt, job.completedAt);

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center hover:bg-muted/60">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <StatusIcon status={job.status} conclusion={job.conclusion} />
          <span className="min-w-0 flex-1 truncate font-medium">
            {job.name}
          </span>
          {elapsed && (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {elapsed}
            </span>
          )}
        </button>
        {onDebug && (
          <Button
            variant="ghost"
            size="xs"
            className="mr-2 shrink-0 text-muted-foreground"
            onClick={onDebug}
          >
            <SparkleIcon data-icon="inline-start" />
            Debug with AI
          </Button>
        )}
      </div>
      {open && job.steps.length > 0 && (
        <ul className="pb-1">
          {job.steps.map((step) => {
            const stepElapsed = duration(step.startedAt, step.completedAt);
            // Deep-link to the step's log section on GitHub (its own steps UI).
            const href = job.url ? `${job.url}#step:${step.number}:1` : null;
            const inner = (
              <>
                <StatusIcon
                  status={step.status}
                  conclusion={step.conclusion}
                  className="size-3.5"
                />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {step.name}
                </span>
                {stepElapsed && (
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {stepElapsed}
                  </span>
                )}
                {href && (
                  <ArrowSquareOutIcon className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                )}
              </>
            );
            return (
              <li key={`${step.number}:${step.name}`}>
                {href ? (
                  <button
                    type="button"
                    onClick={() => openUrl(href)}
                    title="Open this step's logs on GitHub"
                    className="group flex w-full items-center gap-2 py-1 pr-3 pl-10 text-left text-xs hover:bg-muted/40"
                  >
                    {inner}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 py-1 pr-3 pl-10 text-xs">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && job.steps.length === 0 && (
        <p className="py-1 pr-3 pl-10 text-[11px] text-muted-foreground">
          {isRunActive(job.status)
            ? "Waiting for steps…"
            : "No step details available."}
        </p>
      )}
      {open && (
        <div className="pr-3 pb-2 pl-10">
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showLogs ? "Hide logs" : "Show logs"}
          </button>
          {showLogs && (
            <div className="mt-1.5">
              {logs.isPending ? (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Spinner /> Loading logs…
                </div>
              ) : logs.isError ? (
                <p className="text-[11px] text-muted-foreground">
                  Couldn't load logs.
                </p>
              ) : (
                <pre className="max-h-80 overflow-auto border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {logs.data?.trim() || "No logs available."}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RunDetailView({
  repoPath,
  runId,
}: {
  repoPath: string;
  runId: number;
}) {
  const detail = useRunDetail(repoPath, runId);
  const rerun = useRerunRun(repoPath);
  const cancel = useCancelRun(repoPath);
  const aiEnabled = useAiEnabled();
  const [debugJob, setDebugJob] = useState<RunJob | null>(null);
  // Dialog visibility is tracked separately from the debug session so closing
  // the dialog just hides it (the run keeps streaming) and reopening resumes.
  const [debugOpen, setDebugOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const logs = useRunFailedLogs(repoPath, runId, showLogs);

  const run = detail.data;
  const active = run ? isRunActive(run.status) : false;
  const failed = run ? isFailureConclusion(run.conclusion) : false;

  function doRerun(failedOnly: boolean) {
    rerun.mutate(
      { runId, failed: failedOnly },
      {
        onSuccess: () =>
          toast.success(
            failedOnly ? "Re-running failed jobs" : "Re-running workflow",
          ),
        onError: toastError,
      },
    );
  }

  function doCancel() {
    cancel.mutate(runId, {
      onSuccess: () => toast.success("Cancelling run…"),
      onError: toastError,
    });
  }

  if (detail.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (detail.isError || !run) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Couldn't load this run.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-4">
        <div className="flex items-start gap-2">
          <StatusIcon
            status={run.status}
            conclusion={run.conclusion}
            className="mt-0.5 size-5"
          />
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-sm font-semibold"
              title={run.displayTitle}
            >
              {run.displayTitle}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {run.workflowName} · #{run.number} · {run.headBranch} ·{" "}
              {run.event} · {statusLabel(run.status, run.conclusion)}
              {run.createdAt ? ` · ${formatRelativeTime(run.createdAt)}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {active ? (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={doCancel}
            >
              {cancel.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ProhibitIcon data-icon="inline-start" />
              )}
              Cancel run
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={rerun.isPending}
                onClick={() => doRerun(false)}
              >
                <ArrowClockwiseIcon data-icon="inline-start" />
                Re-run all jobs
              </Button>
              {failed && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rerun.isPending}
                  onClick={() => doRerun(true)}
                >
                  <ArrowClockwiseIcon data-icon="inline-start" />
                  Re-run failed jobs
                </Button>
              )}
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={!run.url}
            onClick={() => run.url && openUrl(run.url)}
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            View on GitHub
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            Jobs ({run.jobs.length})
          </h3>
          {run.jobs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {active
                ? "Jobs haven't started yet."
                : "No jobs were reported for this run."}
            </p>
          ) : (
            <div className="border">
              {run.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  repoPath={repoPath}
                  job={job}
                  onDebug={
                    aiEnabled && isFailureConclusion(job.conclusion)
                      ? () => {
                          setDebugJob(job);
                          setDebugOpen(true);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {failed && (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLogs((v) => !v)}
              >
                {showLogs ? "Hide failed-step logs" : "Show failed-step logs"}
              </Button>
              {showLogs && (
                <div className="mt-2">
                  {logs.isPending ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner /> Loading logs…
                    </div>
                  ) : logs.isError ? (
                    <p className="text-xs text-muted-foreground">
                      Couldn't load logs.
                    </p>
                  ) : (
                    <pre
                      className={cn(
                        "max-h-96 overflow-auto border bg-muted/40 p-3",
                        "font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
                      )}
                    >
                      {logs.data?.trim() || "No failed-step logs available."}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <DebugJobDialog
        repoPath={repoPath}
        workflowName={run.workflowName}
        job={debugJob}
        open={debugOpen}
        onOpenChange={setDebugOpen}
      />
    </div>
  );
}
