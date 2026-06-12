import { Popover } from "@base-ui/react/popover";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RecentRepo } from "@/lib/settings/api";
import { useRepoAlias } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { RemoveRepoDialog, RepoAliasDialog } from "./RepoDialogs";
import { RepoList } from "./RepoList";

export function RepoSwitcher() {
  const repoName = useUiStore((s) => s.repoName);
  const repoPath = useUiStore((s) => s.repoPath);
  const alias = useRepoAlias(repoPath);
  const [open, setOpen] = useState(false);
  // Dialogs live outside the popover: closing it unmounts its contents.
  const [aliasTarget, setAliasTarget] = useState<RecentRepo | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RecentRepo | null>(null);

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          render={
            <Button variant="ghost" size="sm" className="max-w-56 gap-1.5">
              <span className="truncate text-sm font-medium">
                {alias ?? repoName ?? "Repository"}
              </span>
              <CaretDownIcon className="shrink-0 text-muted-foreground" />
            </Button>
          }
        />
        <Popover.Portal>
          <Popover.Positioner
            align="start"
            sideOffset={4}
            className="isolate z-50"
          >
            <Popover.Popup className="w-80 rounded-none bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <RepoList
                currentPath={repoPath}
                onOpened={() => setOpen(false)}
                onAliasRepo={(repo) => {
                  setOpen(false);
                  setAliasTarget(repo);
                }}
                onRemoveRepo={(repo) => {
                  setOpen(false);
                  setRemoveTarget(repo);
                }}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <RepoAliasDialog
        key={aliasTarget?.path ?? "none"}
        repo={aliasTarget}
        onClose={() => setAliasTarget(null)}
      />
      <RemoveRepoDialog
        repo={removeTarget}
        onClose={() => setRemoveTarget(null)}
      />
    </>
  );
}
