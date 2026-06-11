import { Popover } from "@base-ui/react/popover";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/lib/stores/ui";
import { RepoList } from "./RepoList";

export function RepoSwitcher() {
  const repoName = useUiStore((s) => s.repoName);
  const repoPath = useUiStore((s) => s.repoPath);
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button variant="ghost" size="sm" className="max-w-56 gap-1.5">
            <span className="truncate text-sm font-medium">
              {repoName ?? "Repository"}
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
            <RepoList currentPath={repoPath} onOpened={() => setOpen(false)} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
