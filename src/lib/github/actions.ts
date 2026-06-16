import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@/lib/tauri/invoke";

// ── Types (mirror the Rust structs in github/actions.rs) ─────────────────────

export interface WorkflowRun {
  id: number;
  number: number;
  displayTitle: string;
  /** queued | in_progress | completed | waiting | requested | pending */
  status: string;
  /** success | failure | cancelled | skipped | … ; "" while still running */
  conclusion: string;
  workflowName: string;
  headBranch: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  headSha: string;
}

export interface RunStep {
  name: string;
  status: string;
  conclusion: string;
  number: number;
}

export interface RunJob {
  id: number;
  name: string;
  status: string;
  conclusion: string;
  startedAt: string;
  completedAt: string;
  url: string;
  steps: RunStep[];
}

export interface RunDetail {
  id: number;
  number: number;
  displayTitle: string;
  status: string;
  conclusion: string;
  workflowName: string;
  headBranch: string;
  event: string;
  createdAt: string;
  url: string;
  headSha: string;
  jobs: RunJob[];
}

export interface Workflow {
  id: number;
  name: string;
  path: string;
  /** active | disabled_manually | disabled_inactivity */
  state: string;
}

// ── Status helpers ───────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
]);

/** A run/job still executing (so the UI keeps polling and offers Cancel). */
export const isRunActive = (status: string) => ACTIVE_STATUSES.has(status);

// ── API wrappers ─────────────────────────────────────────────────────────────

export const ghRunList = (repoPath: string, limit: number, branch?: string) =>
  invoke<WorkflowRun[]>("gh_run_list", {
    repoPath,
    limit,
    branch: branch?.trim() || null,
  });

export const ghRunView = (repoPath: string, runId: number) =>
  invoke<RunDetail>("gh_run_view", { repoPath, runId });

export const ghRunRerun = (repoPath: string, runId: number, failed: boolean) =>
  invoke<void>("gh_run_rerun", { repoPath, runId, failed });

export const ghRunCancel = (repoPath: string, runId: number) =>
  invoke<void>("gh_run_cancel", { repoPath, runId });

export const ghRunFailedLogs = (repoPath: string, runId: number) =>
  invoke<string>("gh_run_failed_logs", { repoPath, runId });

/** One job's failed-step logs (fallback: full job log), for AI debugging. */
export const ghJobLogs = (repoPath: string, jobId: number) =>
  invoke<string>("gh_job_logs", { repoPath, jobId });

export const ghWorkflowList = (repoPath: string) =>
  invoke<Workflow[]>("gh_workflow_list", { repoPath });

export const ghWorkflowRun = (
  repoPath: string,
  workflow: string,
  gitRef: string,
  inputs: Record<string, string>,
) => invoke<void>("gh_workflow_run", { repoPath, workflow, gitRef, inputs });

// ── Queries ──────────────────────────────────────────────────────────────────

/** Polls every 5s while any listed run is active, otherwise stays idle. */
export function useWorkflowRuns(
  repo: string,
  enabled: boolean,
  branch?: string,
) {
  return useQuery({
    queryKey: ["repo", repo, "actions", "runs", branch ?? ""] as const,
    queryFn: () => ghRunList(repo, 40, branch),
    enabled,
    staleTime: 10_000,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => isRunActive(r.status))
        ? 5000
        : false,
  });
}

export function useRunDetail(repo: string, runId: number | null) {
  return useQuery({
    queryKey: ["repo", repo, "actions", "run", runId ?? 0] as const,
    queryFn: () => ghRunView(repo, runId ?? 0),
    enabled: runId !== null,
    refetchInterval: (query) =>
      query.state.data && isRunActive(query.state.data.status) ? 5000 : false,
  });
}

/**
 * The single most recent run on a branch, for the header CI badge. Polls fast
 * while it's active, slowly otherwise so a freshly-pushed run still shows up.
 */
export function useLatestRun(
  repo: string,
  enabled: boolean,
  branch: string | null,
) {
  return useQuery({
    queryKey: ["repo", repo, "actions", "latest", branch ?? ""] as const,
    queryFn: async () =>
      (await ghRunList(repo, 1, branch ?? undefined))[0] ?? null,
    enabled: enabled && Boolean(branch),
    staleTime: 15_000,
    refetchInterval: (query) =>
      query.state.data && isRunActive(query.state.data.status) ? 8000 : 30_000,
  });
}

export function useWorkflows(repo: string, enabled: boolean) {
  return useQuery({
    queryKey: ["repo", repo, "actions", "workflows"] as const,
    queryFn: () => ghWorkflowList(repo),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Failed-step logs, fetched only when the user expands them. */
export function useRunFailedLogs(
  repo: string,
  runId: number | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["repo", repo, "actions", "run", runId ?? 0, "logs"] as const,
    queryFn: () => ghRunFailedLogs(repo, runId ?? 0),
    enabled: enabled && runId !== null,
    staleTime: 30_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

function useActionsMutation<TArgs>(
  repo: string,
  mutationFn: (args: TArgs) => Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    // Scope the refresh to Actions — re-run/cancel/dispatch don't touch git state.
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["repo", repo, "actions"],
      }),
  });
}

export function useRerunRun(repo: string) {
  return useActionsMutation(repo, (args: { runId: number; failed: boolean }) =>
    ghRunRerun(repo, args.runId, args.failed),
  );
}

export function useCancelRun(repo: string) {
  return useActionsMutation(repo, (runId: number) => ghRunCancel(repo, runId));
}

export function useRunWorkflow(repo: string) {
  return useActionsMutation(
    repo,
    (args: {
      workflow: string;
      gitRef: string;
      inputs: Record<string, string>;
    }) => ghWorkflowRun(repo, args.workflow, args.gitRef, args.inputs),
  );
}
