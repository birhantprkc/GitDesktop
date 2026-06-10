import {
  CaretDownIcon,
  CheckIcon,
  GitBranchIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useBranches,
  useCheckoutBranch,
  useCreateBranch,
  useRepoStatus,
} from "@/lib/git/queries";
import { errorMessage } from "@/lib/tauri/invoke";

export function BranchSwitcher({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const branches = useBranches(repoPath);
  const checkout = useCheckoutBranch(repoPath);
  const createBranch = useCreateBranch(repoPath);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const head = status.data?.branch;
  const currentLabel = head?.detached
    ? `detached @ ${head.oid?.slice(0, 7) ?? "?"}`
    : (head?.name ?? "…");

  function switchTo(name: string) {
    checkout.mutate(name, {
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  function create() {
    createBranch.mutate(
      { name: newName.trim(), checkout: true },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setNewName("");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" disabled={checkout.isPending}>
              <GitBranchIcon data-icon="inline-start" />
              {currentLabel}
              {head?.detached && (
                <Badge variant="secondary" className="ml-1">
                  detached
                </Badge>
              )}
              <CaretDownIcon data-icon="inline-end" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Branches</DropdownMenuLabel>
            {(branches.data ?? []).map((branch) => (
              <DropdownMenuItem
                key={branch.name}
                onClick={() => {
                  if (!branch.isCurrent) switchTo(branch.name);
                }}
              >
                <span className="flex-1 truncate">{branch.name}</span>
                {branch.isCurrent && <CheckIcon className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-3.5" />
            New branch…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>
              Creates a branch from the current HEAD and switches to it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="branch-name">Branch name</Label>
            <Input
              id="branch-name"
              placeholder="feature/my-change"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) create();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={create}
              disabled={!newName.trim() || createBranch.isPending}
            >
              Create branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
