import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommitBox } from "@/features/commit/CommitBox";
import { BranchDiffView } from "@/features/compare/BranchDiffView";
import { ComparePanel } from "@/features/compare/ComparePanel";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffViewer } from "@/features/diff/DiffViewer";
import { CommitDetailView } from "@/features/history/CommitDetailView";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import { LocalPrView } from "@/features/pulls/LocalPrView";
import { PullRequestsPanel } from "@/features/pulls/PullRequestsPanel";
import { RemotePrView } from "@/features/pulls/RemotePrView";
import { useRepoStatus } from "@/lib/git/queries";
import { type RepoTab, useUiStore } from "@/lib/stores/ui";
import { ChangesPanel } from "./ChangesPanel";
import { RepoHeader } from "./RepoHeader";

const TAB_ORDER: RepoTab[] = ["changes", "history", "compare", "pulls"];

export function RepositoryView() {
  const repoPath = useUiStore((s) => s.repoPath);
  const repoName = useUiStore((s) => s.repoName);
  const repoTab = useUiStore((s) => s.repoTab);
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  const selectedCommitHash = useUiStore((s) => s.selectedCommitHash);
  const compareBranch = useUiStore((s) => s.compareBranch);
  const selectedPr = useUiStore((s) => s.selectedPr);
  const status = useRepoStatus(repoPath ?? "");
  const currentName = status.data?.branch?.name ?? null;

  // Ctrl/Cmd+1–4 switch tabs, mirroring GitHub Desktop.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const index = Number(e.key) - 1;
      const tab = TAB_ORDER[index];
      if (tab) {
        e.preventDefault();
        setRepoTab(tab);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setRepoTab]);

  // "repo • branch" in the OS title bar (and Alt-Tab) while a repo is open.
  useEffect(() => {
    if (!repoName) return;
    const title = currentName ? `${repoName} • ${currentName}` : repoName;
    getCurrentWindow()
      .setTitle(`${title} — GitDesktop`)
      .catch(() => undefined);
    return () => {
      getCurrentWindow()
        .setTitle("GitDesktop")
        .catch(() => undefined);
    };
  }, [repoName, currentName]);

  if (!repoPath) return null;

  function sidebar() {
    if (!repoPath) return null;
    switch (repoTab) {
      case "changes":
        return (
          <>
            <ChangesPanel repoPath={repoPath} />
            <CommitBox repoPath={repoPath} />
          </>
        );
      case "history":
        return <HistoryPanel repoPath={repoPath} />;
      case "compare":
        return <ComparePanel repoPath={repoPath} />;
      case "pulls":
        return <PullRequestsPanel repoPath={repoPath} />;
    }
  }

  function main() {
    if (!repoPath) return null;
    switch (repoTab) {
      case "changes":
        return <DiffViewer repoPath={repoPath} />;
      case "history":
        return selectedCommitHash ? (
          <CommitDetailView repoPath={repoPath} hash={selectedCommitHash} />
        ) : (
          <DiffPlaceholder message="Select a commit to see its changes" />
        );
      case "compare":
        return selectedCommitHash ? (
          <CommitDetailView repoPath={repoPath} hash={selectedCommitHash} />
        ) : compareBranch && currentName && compareBranch !== currentName ? (
          <BranchDiffView
            repoPath={repoPath}
            base={compareBranch}
            compare={currentName}
          />
        ) : (
          <DiffPlaceholder message="Pick a branch to compare against" />
        );
      case "pulls":
        return selectedPr?.kind === "remote" ? (
          <RemotePrView repoPath={repoPath} number={Number(selectedPr.id)} />
        ) : selectedPr?.kind === "local" ? (
          <LocalPrView repoPath={repoPath} id={selectedPr.id} />
        ) : (
          <DiffPlaceholder message="Select a pull request" />
        );
    }
  }

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
              <TabsTrigger value="pulls" className="flex-1">
                Pull Requests
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {sidebar()}
        </aside>
        <main className="min-w-0 flex-1">{main()}</main>
      </div>
    </div>
  );
}
