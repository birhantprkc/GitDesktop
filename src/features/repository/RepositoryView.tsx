import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommitBox } from "@/features/commit/CommitBox";
import { BranchDiffView } from "@/features/compare/BranchDiffView";
import { ComparePanel } from "@/features/compare/ComparePanel";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffViewer } from "@/features/diff/DiffViewer";
import { CommitDetailView } from "@/features/history/CommitDetailView";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import { useRepoStatus } from "@/lib/git/queries";
import { type RepoTab, useUiStore } from "@/lib/stores/ui";
import { ChangesPanel } from "./ChangesPanel";
import { RepoHeader } from "./RepoHeader";

export function RepositoryView() {
  const repoPath = useUiStore((s) => s.repoPath);
  const repoTab = useUiStore((s) => s.repoTab);
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  const selectedCommitHash = useUiStore((s) => s.selectedCommitHash);
  const compareBranch = useUiStore((s) => s.compareBranch);
  const status = useRepoStatus(repoPath ?? "");
  const currentName = status.data?.branch?.name ?? null;
  if (!repoPath) return null;

  return (
    <div className="flex h-screen flex-col">
      <RepoHeader repoPath={repoPath} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r">
          <Tabs
            value={repoTab}
            onValueChange={(value) => setRepoTab(value as RepoTab)}
          >
            <TabsList className="w-full">
              <TabsTrigger value="changes" className="flex-1">
                Changes
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-1">
                History
              </TabsTrigger>
              <TabsTrigger value="compare" className="flex-1">
                Compare
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {repoTab === "changes" ? (
            <>
              <ChangesPanel repoPath={repoPath} />
              <CommitBox repoPath={repoPath} />
            </>
          ) : repoTab === "history" ? (
            <HistoryPanel repoPath={repoPath} />
          ) : (
            <ComparePanel repoPath={repoPath} />
          )}
        </aside>
        <main className="min-w-0 flex-1">
          {repoTab === "changes" ? (
            <DiffViewer repoPath={repoPath} />
          ) : repoTab === "history" ? (
            selectedCommitHash ? (
              <CommitDetailView repoPath={repoPath} hash={selectedCommitHash} />
            ) : (
              <DiffPlaceholder message="Select a commit to see its changes" />
            )
          ) : selectedCommitHash ? (
            <CommitDetailView repoPath={repoPath} hash={selectedCommitHash} />
          ) : compareBranch && currentName && compareBranch !== currentName ? (
            <BranchDiffView
              repoPath={repoPath}
              base={compareBranch}
              compare={currentName}
            />
          ) : (
            <DiffPlaceholder message="Pick a branch to compare against" />
          )}
        </main>
      </div>
    </div>
  );
}
