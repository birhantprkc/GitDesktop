import {
  forgeFeatureReady,
  useForgeStatus,
  useRepoStatus,
} from "@/lib/git/queries";
import { useLatestRun } from "@/lib/github/actions";
import { useUiStore } from "@/lib/stores/ui";
import { StatusIcon, statusLabel } from "./status";

/**
 * Glanceable CI status for the current branch's latest run, in the repo header.
 * Renders nothing until gh is ready and a run exists; clicking jumps to the
 * Actions tab with that run selected.
 */
export function BranchCiBadge({ repoPath }: { repoPath: string }) {
  const gh = useForgeStatus(repoPath);
  // GitHub Actions only so far — no CI badge for GitLab until its CI read lands.
  const ghReady = forgeFeatureReady(gh.data, "ci");
  const status = useRepoStatus(repoPath);
  const branch = status.data?.branch.name ?? null;
  const latest = useLatestRun(repoPath, ghReady, branch);
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  const selectRun = useUiStore((s) => s.selectRun);

  const run = latest.data;
  if (!run) return null;

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-none px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      title={`${run.workflowName}: ${statusLabel(run.status, run.conclusion)} — view in Actions`}
      onClick={() => {
        selectRun(run.id);
        setRepoTab("actions");
      }}
    >
      <StatusIcon
        status={run.status}
        conclusion={run.conclusion}
        className="size-3.5"
      />
      <span className="hidden max-w-32 truncate sm:inline">
        {run.workflowName}
      </span>
    </button>
  );
}
