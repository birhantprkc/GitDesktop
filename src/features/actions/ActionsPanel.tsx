import { ArrowClockwiseIcon, PlayIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { GhNotReady } from "@/features/repository/GhNotReady";
import { useGhStatus, useRepoStatus } from "@/lib/git/queries";
import { useWorkflowRuns } from "@/lib/github/actions";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { RunWorkflowDialog } from "./RunWorkflowDialog";
import { StatusIcon, statusLabel } from "./status";

export function ActionsPanel({ repoPath }: { repoPath: string }) {
  const gh = useGhStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const status = useRepoStatus(repoPath);
  const currentBranch = status.data?.branch.name ?? null;

  const [branchOnly, setBranchOnly] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const runs = useWorkflowRuns(
    repoPath,
    ghReady,
    branchOnly && currentBranch ? currentBranch : undefined,
  );
  const selectedRunId = useUiStore((s) => s.selectedRunId);
  const selectRun = useUiStore((s) => s.selectRun);

  useHotkeyAction("focus-filter", () => filterRef.current?.focus());

  const query = filterText.trim().toLowerCase();
  const allRuns = runs.data ?? [];
  const visible = allRuns.filter(
    (r) =>
      !query ||
      r.displayTitle.toLowerCase().includes(query) ||
      r.workflowName.toLowerCase().includes(query) ||
      r.headBranch.toLowerCase().includes(query),
  );

  const onListKeyDown = listKeyboardNav({
    items: visible,
    activeIndex: visible.findIndex((r) => r.id === selectedRunId),
    onActivate: (run) => selectRun(run.id),
    rowKey: (run) => String(run.id),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b p-2">
        <Button
          variant={branchOnly ? "secondary" : "ghost"}
          size="xs"
          aria-pressed={branchOnly}
          disabled={!currentBranch}
          title={
            currentBranch
              ? `Show runs on ${currentBranch} only`
              : "No current branch"
          }
          onClick={() => setBranchOnly((v) => !v)}
        >
          This branch
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={!ghReady}
          onClick={() => setRunOpen(true)}
        >
          <PlayIcon data-icon="inline-start" />
          Run workflow…
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Refresh runs"
          disabled={!ghReady || runs.isFetching}
          onClick={() => runs.refetch()}
        >
          <ArrowClockwiseIcon
            className={cn(runs.isFetching && "animate-spin")}
          />
        </Button>
      </div>
      <div className="border-b p-2">
        <Input
          ref={filterRef}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter by title, workflow, or branch"
          className="h-7"
          autoComplete="off"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {gh.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !ghReady ? (
          <GhNotReady repoPath={repoPath} feature="workflow runs" />
        ) : runs.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : runs.isError ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            Couldn't load workflow runs. Refresh to try again.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {allRuns.length > 0
              ? "No runs match the filter."
              : branchOnly
                ? "No workflow runs on this branch yet."
                : "No workflow runs yet."}
          </p>
        ) : (
          <div onKeyDown={onListKeyDown}>
            {visible.map((run) => {
              const active = run.id === selectedRunId;
              return (
                <button
                  type="button"
                  key={run.id}
                  data-row={String(run.id)}
                  className={cn(
                    "block w-full border-b px-3 py-2 text-left",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/60",
                  )}
                  onClick={() => selectRun(run.id)}
                  onDoubleClick={() => run.url && openUrl(run.url)}
                >
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <StatusIcon
                      status={run.status}
                      conclusion={run.conclusion}
                      className="size-3.5"
                    />
                    <span className="truncate" title={run.displayTitle}>
                      {run.displayTitle}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate pl-5 text-[11px] text-muted-foreground">
                    {run.workflowName} · {run.headBranch} ·{" "}
                    {statusLabel(run.status, run.conclusion)}
                    {run.updatedAt
                      ? ` · ${formatRelativeTime(run.updatedAt)}`
                      : ""}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <RunWorkflowDialog
        repoPath={repoPath}
        open={runOpen}
        onOpenChange={setRunOpen}
        defaultRef={currentBranch ?? ""}
      />
    </div>
  );
}
