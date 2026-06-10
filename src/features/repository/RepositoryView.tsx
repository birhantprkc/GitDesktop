import { CommitBox } from "@/features/commit/CommitBox";
import { DiffViewer } from "@/features/diff/DiffViewer";
import { useUiStore } from "@/lib/stores/ui";
import { ChangesPanel } from "./ChangesPanel";
import { RepoHeader } from "./RepoHeader";

export function RepositoryView() {
  const repoPath = useUiStore((s) => s.repoPath);
  if (!repoPath) return null;

  return (
    <div className="flex h-screen flex-col">
      <RepoHeader repoPath={repoPath} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r">
          <ChangesPanel repoPath={repoPath} />
          <CommitBox repoPath={repoPath} />
        </aside>
        <main className="min-w-0 flex-1">
          <DiffViewer repoPath={repoPath} />
        </main>
      </div>
    </div>
  );
}
