import { Popover } from "@base-ui/react/popover";
import { CaretDownIcon, CheckIcon, GitBranchIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyText } from "@/lib/clipboard";
import {
  useBranches,
  useCheckoutBranch,
  useCreateBranch,
  useDefaultBranch,
  useDeleteBranch,
  useDiscardAll,
  useMergeBranch,
  useRebaseBranch,
  useRenameBranch,
  useRepoStatus,
  useStashAll,
  useStashCount,
  useStashPop,
} from "@/lib/git/queries";
import { errorMessage } from "@/lib/tauri/invoke";

type PickerMode = "merge" | "squash" | "rebase";

const PICKER_COPY: Record<
  PickerMode,
  { title: (current: string) => string; action: string }
> = {
  merge: { title: (c) => `Merge into ${c}`, action: "Merge" },
  squash: {
    title: (c) => `Squash and merge into ${c}`,
    action: "Squash and merge",
  },
  rebase: { title: (c) => `Rebase ${c} onto`, action: "Rebase" },
};

function MenuRow({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function BranchSwitcher({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const branches = useBranches(repoPath);
  const defaultBranch = useDefaultBranch(repoPath);
  const stashCount = useStashCount(repoPath);
  const checkout = useCheckoutBranch(repoPath);
  const createBranch = useCreateBranch(repoPath);
  const renameBranch = useRenameBranch(repoPath);
  const deleteBranch = useDeleteBranch(repoPath);
  const discardAll = useDiscardAll(repoPath);
  const stashAll = useStashAll(repoPath);
  const stashPop = useStashPop(repoPath);
  const mergeBranch = useMergeBranch(repoPath);
  const rebaseBranch = useRebaseBranch(repoPath);

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null);
  const [pickerBranch, setPickerBranch] = useState("");

  const head = status.data?.branch;
  const currentName = head?.name ?? null;
  const currentLabel = head?.detached
    ? `detached @ ${head.oid?.slice(0, 7) ?? "?"}`
    : (currentName ?? "…");
  const allBranches = branches.data ?? [];
  const otherBranches = allBranches.filter((b) => !b.isCurrent);
  const defaultName = defaultBranch.data ?? null;
  const stashes = stashCount.data ?? 0;

  const onError = (e: unknown) => toast.error(errorMessage(e));

  function switchTo(name: string) {
    setOpen(false);
    checkout.mutate(name, { onError });
  }

  function create() {
    createBranch.mutate(
      { name: newName.trim(), checkout: true },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setNewName("");
        },
        onError,
      },
    );
  }

  function doRename() {
    if (!renameTarget) return;
    renameBranch.mutate(
      { oldName: renameTarget, newName: renameValue.trim() },
      {
        onSuccess: () => {
          toast.success(`Renamed to ${renameValue.trim()}`);
          setRenameTarget(null);
        },
        onError,
      },
    );
  }

  async function doDelete() {
    if (!deleteTarget) return;
    try {
      // git refuses to delete the checked-out branch: move off it first
      if (deleteTarget === currentName) {
        const fallback =
          defaultName && defaultName !== deleteTarget
            ? defaultName
            : otherBranches[0]?.name;
        if (!fallback) {
          toast.error("Cannot delete the only branch.");
          setDeleteTarget(null);
          return;
        }
        await checkout.mutateAsync(fallback);
      }
      await deleteBranch.mutateAsync(deleteTarget);
      toast.success(`Deleted ${deleteTarget}`);
    } catch (e) {
      onError(e);
    } finally {
      setDeleteTarget(null);
    }
  }

  function runPicker() {
    if (!pickerMode || !pickerBranch) return;
    const mode = pickerMode;
    const branch = pickerBranch;
    setPickerMode(null);
    if (mode === "rebase") {
      rebaseBranch.mutate(branch, {
        onSuccess: () => toast.success(`Rebased onto ${branch}`),
        onError,
      });
    } else {
      mergeBranch.mutate(
        { branch, squash: mode === "squash" },
        {
          onSuccess: () =>
            toast.success(
              mode === "squash"
                ? `Squashed ${branch} — changes are staged, review and commit`
                : `Merged ${branch}`,
            ),
          onError,
        },
      );
    }
  }

  function openPicker(mode: PickerMode) {
    setOpen(false);
    setPickerBranch(otherBranches[0]?.name ?? "");
    setPickerMode(mode);
  }

  const busy =
    checkout.isPending || mergeBranch.isPending || rebaseBranch.isPending;

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          render={
            <Button variant="ghost" size="sm" disabled={busy}>
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
        <Popover.Portal>
          <Popover.Positioner
            align="start"
            sideOffset={4}
            className="isolate z-50"
          >
            <Popover.Popup className="w-72 rounded-none bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                Branches
              </p>
              <div className="max-h-60 overflow-y-auto">
                {allBranches.map((branch) => (
                  <ContextMenu key={branch.name}>
                    <ContextMenuTrigger
                      render={
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            if (!branch.isCurrent) switchTo(branch.name);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {branch.name}
                          </span>
                          {branch.isCurrent && (
                            <CheckIcon className="size-3.5 shrink-0" />
                          )}
                        </button>
                      }
                    />
                    <ContextMenuContent className="min-w-48">
                      <ContextMenuItem
                        onClick={() => {
                          setOpen(false);
                          setRenameValue(branch.name);
                          setRenameTarget(branch.name);
                        }}
                      >
                        Rename…
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          copyText(branch.name, "Branch name copied")
                        }
                      >
                        Copy branch name
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => {
                          setOpen(false);
                          setDeleteTarget(branch.name);
                        }}
                      >
                        Delete…
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
              <div className="border-t py-1">
                <MenuRow
                  onClick={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  New branch…
                </MenuRow>
                <MenuRow
                  disabled={!currentName}
                  onClick={() => {
                    if (!currentName) return;
                    setOpen(false);
                    setRenameValue(currentName);
                    setRenameTarget(currentName);
                  }}
                >
                  Rename current branch…
                </MenuRow>
                <MenuRow
                  disabled={!currentName}
                  onClick={() => {
                    if (!currentName) return;
                    setOpen(false);
                    setDeleteTarget(currentName);
                  }}
                >
                  Delete current branch…
                </MenuRow>
              </div>
              <div className="border-t py-1">
                <MenuRow
                  onClick={() => {
                    setOpen(false);
                    setDiscardAllOpen(true);
                  }}
                >
                  Discard all changes…
                </MenuRow>
                <MenuRow
                  onClick={() => {
                    setOpen(false);
                    stashAll.mutate(undefined, {
                      onSuccess: () => toast.success("Changes stashed"),
                      onError,
                    });
                  }}
                >
                  Stash all changes
                </MenuRow>
                <MenuRow
                  disabled={stashes === 0}
                  onClick={() => {
                    setOpen(false);
                    stashPop.mutate(undefined, {
                      onSuccess: () => toast.success("Stash restored"),
                      onError,
                    });
                  }}
                >
                  Pop latest stash{stashes > 0 ? ` (${stashes})` : ""}
                </MenuRow>
              </div>
              <div className="border-t py-1">
                <MenuRow
                  disabled={!defaultName || defaultName === currentName || busy}
                  onClick={() => {
                    if (!defaultName) return;
                    setOpen(false);
                    mergeBranch.mutate(
                      { branch: defaultName, squash: false },
                      {
                        onSuccess: () =>
                          toast.success(`Updated from ${defaultName}`),
                        onError,
                      },
                    );
                  }}
                >
                  Update from {defaultName ?? "default branch"}
                </MenuRow>
                <MenuRow
                  disabled={otherBranches.length === 0}
                  onClick={() => openPicker("merge")}
                >
                  Merge into current branch…
                </MenuRow>
                <MenuRow
                  disabled={otherBranches.length === 0}
                  onClick={() => openPicker("squash")}
                >
                  Squash and merge into current branch…
                </MenuRow>
                <MenuRow
                  disabled={otherBranches.length === 0}
                  onClick={() => openPicker("rebase")}
                >
                  Rebase current branch…
                </MenuRow>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

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

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename branch</DialogTitle>
            <DialogDescription>Renames {renameTarget}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-branch">New name</Label>
            <Input
              id="rename-branch"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim()) doRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={doRename}
              disabled={
                !renameValue.trim() ||
                renameValue.trim() === renameTarget ||
                renameBranch.isPending
              }
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete branch?</DialogTitle>
            <DialogDescription>
              Deletes {deleteTarget} locally, including commits that exist only
              on it.
              {deleteTarget === currentName &&
                " You'll be switched to another branch first."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBranch.isPending || checkout.isPending}
              onClick={doDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardAllOpen} onOpenChange={setDiscardAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard all changes?</DialogTitle>
            <DialogDescription>
              All uncommitted changes are discarded: tracked files reset to the
              last commit, untracked files move to the recycle bin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardAllOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={discardAll.isPending}
              onClick={() =>
                discardAll.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("All changes discarded");
                    setDiscardAllOpen(false);
                  },
                  onError: (e) => {
                    onError(e);
                    setDiscardAllOpen(false);
                  },
                })
              }
            >
              Discard all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pickerMode !== null}
        onOpenChange={(o) => {
          if (!o) setPickerMode(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pickerMode ? PICKER_COPY[pickerMode].title(currentLabel) : ""}
            </DialogTitle>
            <DialogDescription>
              {pickerMode === "rebase"
                ? "Replays your branch's commits on top of the selected branch. Aborted automatically on conflicts."
                : pickerMode === "squash"
                  ? "Combines the selected branch's changes into staged changes for a single commit."
                  : "Merge conflicts, if any, will appear in the changes list."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Branch</Label>
            <Select
              items={Object.fromEntries(
                otherBranches.map((b) => [b.name, b.name]),
              )}
              value={pickerBranch || null}
              onValueChange={(v) => v && setPickerBranch(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {otherBranches.map((b) => (
                  <SelectItem key={b.name} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerMode(null)}>
              Cancel
            </Button>
            <Button onClick={runPicker} disabled={!pickerBranch}>
              {pickerMode ? PICKER_COPY[pickerMode].action : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
