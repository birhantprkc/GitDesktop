import { getCurrentWindow } from "@tauri-apps/api/window";
import { Activity, useEffect, useTransition } from "react";
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
import { useRepoAlias } from "@/lib/settings/queries";
import { type RepoTab, useUiStore } from "@/lib/stores/ui";
import { ChangesPanel } from "./ChangesPanel";
import { RepoHeader } from "./RepoHeader";
import { usePrNotifications } from "./usePrNotifications";

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
  const alias = useRepoAlias(repoPath);
  const currentName = status.data?.branch?.name ?? null;
  // Tab switches are transitions: a heavy first render of the target panel
  // never blocks the click, and hidden Activities pre-render at low priority.
  const [, startTabTransition] = useTransition();

  // OS notifications for PR/check events while this repo is open.
  usePrNotifications(repoPath ?? "");

  function changeTab(tab: RepoTab) {
    startTabTransition(() => setRepoTab(tab));
  }

  // Ctrl/Cmd+1–4 switch tabs, mirroring GitHub Desktop.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const index = Number(e.key) - 1;
      const tab = TAB_ORDER[index];
      if (tab) {
        e.preventDefault();
        startTabTransition(() => setRepoTab(tab));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setRepoTab]);

  // "repo • branch" in the OS title bar (and Alt-Tab) while a repo is open.
  useEffect(() => {
    const display = alias ?? repoName;
    if (!display) return;
    const title = currentName ? `${display} • ${currentName}` : display;
    getCurrentWindow()
      .setTitle(`${title} — GitDesktop`)
      .catch(() => undefined);
    return () => {
      getCurrentWindow()
        .setTitle("GitDesktop")
        .catch(() => undefined);
    };
  }, [repoName, alias, currentName]);

  if (!repoPath) return null;

  // Panels live inside <Activity> so switching tabs preserves their state
  // (filters, selections, scroll) instead of unmounting them. Hidden panels'
  // effects are deferred, so inactive tabs don't poll or fetch.
  const mode = (tab: RepoTab) => (repoTab === tab ? "visible" : "hidden");

  return (
    <div className="flex h-screen flex-col">
      <RepoHeader repoPath={repoPath} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r">
          <Tabs
            value={repoTab}
            onValueChange={(value) => changeTab(value as RepoTab)}
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
          <Activity mode={mode("changes")}>
            <ChangesPanel repoPath={repoPath} />
            <CommitBox repoPath={repoPath} />
          </Activity>
          <Activity mode={mode("history")}>
            <HistoryPanel repoPath={repoPath} />
          </Activity>
          <Activity mode={mode("compare")}>
            <ComparePanel repoPath={repoPath} />
          </Activity>
          <Activity mode={mode("pulls")}>
            <PullRequestsPanel repoPath={repoPath} />
          </Activity>
        </aside>
        <main className="min-w-0 flex-1">
          <Activity mode={mode("changes")}>
            <DiffViewer repoPath={repoPath} />
          </Activity>
          <Activity mode={mode("history")}>
            {selectedCommitHash ? (
              <CommitDetailView repoPath={repoPath} hash={selectedCommitHash} />
            ) : (
              <DiffPlaceholder message="Select a commit to see its changes" />
            )}
          </Activity>
          <Activity mode={mode("compare")}>
            {selectedCommitHash ? (
              <CommitDetailView repoPath={repoPath} hash={selectedCommitHash} />
            ) : compareBranch &&
              currentName &&
              compareBranch !== currentName ? (
              <BranchDiffView
                repoPath={repoPath}
                base={compareBranch}
                compare={currentName}
              />
            ) : (
              <DiffPlaceholder message="Pick a branch to compare against" />
            )}
          </Activity>
          <Activity mode={mode("pulls")}>
            {selectedPr?.kind === "remote" ? (
              <RemotePrView
                repoPath={repoPath}
                number={Number(selectedPr.id)}
              />
            ) : selectedPr?.kind === "local" ? (
              <LocalPrView repoPath={repoPath} id={selectedPr.id} />
            ) : (
              <DiffPlaceholder message="Select a pull request" />
            )}
          </Activity>
        </main>
      </div>
    </div>
  );
}
