import { ArrowLeftIcon, GearIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useUiStore } from "@/lib/stores/ui";
import { BranchSwitcher } from "./BranchSwitcher";
import { RepositoryMenu } from "./RepositoryMenu";
import { SyncControls } from "./SyncControls";

export function RepoHeader({ repoPath }: { repoPath: string }) {
  const repoName = useUiStore((s) => s.repoName);
  const closeRepo = useUiStore((s) => s.closeRepo);
  const openSettings = useUiStore((s) => s.openSettings);

  return (
    <header className="flex items-center gap-2 border-b px-3 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Back to repositories"
        onClick={closeRepo}
      >
        <ArrowLeftIcon />
      </Button>
      <RepositoryMenu repoPath={repoPath} repoName={repoName ?? "Repository"} />
      <Separator orientation="vertical" className="h-5" />
      <BranchSwitcher repoPath={repoPath} />
      <div className="flex-1" />
      <SyncControls repoPath={repoPath} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Settings"
        onClick={openSettings}
      >
        <GearIcon />
      </Button>
    </header>
  );
}
