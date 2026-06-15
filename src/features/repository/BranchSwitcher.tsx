import { Popover } from "@base-ui/react/popover";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CheckIcon,
  GitBranchIcon,
} from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  branchNameError,
  branchNameHint,
  isDeletionBlocked,
  isMergeMethodAllowed,
  requiresPullRequest,
} from "@/lib/branch-rules/match";
import { useEffectiveBranchRules } from "@/lib/branch-rules/queries";
import { copyText } from "@/lib/clipboard";
import { required, useAppForm } from "@/lib/form";
import {
  useBranchDivergence,
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
  useUpdateBranchFrom,
} from "@/lib/git/queries";
import { refNameWarning, sanitizeRefName } from "@/lib/git/ref-name";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { StashesDialog } from "./StashesDialog";

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
  const updateBranchFrom = useUpdateBranchFrom(repoPath);
  const rulesConfig = useEffectiveBranchRules(repoPath);
  const amendingHash = useUiStore((s) => s.amendingHash);

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const [stashAllOpen, setStashAllOpen] = useState(false);
  const [stashPopOpen, setStashPopOpen] = useState(false);
  const [stashesOpen, setStashesOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null);
  const [pickerBranch, setPickerBranch] = useState("");
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);

  const head = status.data?.branch;
  const currentName = head?.name ?? null;
  const currentLabel = head?.detached
    ? `detached @ ${head.oid?.slice(0, 7) ?? "?"}`
    : (currentName ?? "…");
  const allBranches = branches.data ?? [];
  const otherBranches = allBranches.filter((b) => !b.isCurrent);
  const defaultName = defaultBranch.data ?? null;
  // Merge-into-current is gated by the current branch's protection: a
  // "require pull request" rule blocks all direct merges, and a merge-method
  // restriction blocks the disallowed methods.
  const lockCurrent = currentName
    ? requiresPullRequest(rulesConfig, currentName)
    : false;
  const canMergeIntoCurrent =
    !lockCurrent &&
    (currentName
      ? isMergeMethodAllowed(rulesConfig, currentName, "merge")
      : true);
  const canSquashIntoCurrent =
    !lockCurrent &&
    (currentName
      ? isMergeMethodAllowed(rulesConfig, currentName, "squash")
      : true);
  // Ahead/behind vs. the default branch, fetched only while the menu is open.
  const divergence = useBranchDivergence(repoPath, defaultName, open);
  const divByName = new Map(
    (divergence.data ?? []).map((d) => [d.name, d] as const),
  );
  // Default branch pinned on top, then the rest by most recently committed.
  const sortedBranches = [...allBranches].sort((a, b) => {
    if (a.name === defaultName) return -1;
    if (b.name === defaultName) return 1;
    return b.lastCommitDate.localeCompare(a.lastCommitDate);
  });
  const stashes = stashCount.data ?? 0;
  const hasChanges = (status.data?.entries.length ?? 0) > 0;
  // You can't amend across branches: amend mode targets a specific commit on
  // this branch, so switching would strand the in-progress amend and leave its
  // banner up. Lock the switcher until the user finishes or stops amending.
  const amending = amendingHash !== null;
  // Bases offered when creating a branch: the current branch and/or the
  // default branch (deduped — they're the same when you're on the default).
  const baseOptions = [
    ...new Set(
      [currentName, defaultName].filter((b): b is string => Boolean(b)),
    ),
  ];

  const onError = (e: unknown) => toastError(e);

  function switchTo(name: string) {
    if (amending) return; // guarded by the disabled trigger; belt-and-suspenders
    setOpen(false);
    // with work in progress, let the user choose to bring or stash it
    if (hasChanges) {
      setSwitchTarget(name);
      return;
    }
    checkout.mutate(name, { onError });
  }

  function bringAndSwitch() {
    if (!switchTarget) return;
    const target = switchTarget;
    setSwitchTarget(null);
    checkout.mutate(target, { onError });
  }

  async function stashAndSwitch() {
    if (!switchTarget) return;
    const target = switchTarget;
    setSwitchTarget(null);
    try {
      await stashAll.mutateAsync(undefined);
      await checkout.mutateAsync(target);
      toast.success(
        `Stashed changes and switched to ${target} — "Pop latest stash" restores them`,
      );
    } catch (e) {
      onError(e);
    }
  }

  const createForm = useAppForm({
    defaultValues: { name: "", base: "" },
    onSubmit: async ({ value }) => {
      try {
        await createBranch.mutateAsync({
          name: sanitizeRefName(value.name),
          checkout: true,
          startPoint: value.base || undefined,
        });
        setCreateOpen(false);
      } catch (e) {
        onError(e);
      }
    },
  });
  // Drives the "Branches from …" copy in the dialog description.
  const createBase = useSelector(createForm.store, (s) => s.values.base);

  const renameForm = useAppForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      if (!renameTarget) return;
      const newName = sanitizeRefName(value.name);
      try {
        await renameBranch.mutateAsync({ oldName: renameTarget, newName });
        toast.success(`Renamed to ${newName}`);
        setRenameTarget(null);
      } catch (e) {
        onError(e);
      }
    },
  });

  // NOTE: seeding resets must pass keepDefaultValues — otherwise reset()
  // rewrites the form's defaultValues, and react-form's per-render options
  // sync sees "different defaults + untouched form" and clobbers the seeded
  // values right back on the next render.
  function openRename(branch: string) {
    setOpen(false);
    renameForm.reset({ name: branch }, { keepDefaultValues: true });
    setRenameTarget(branch);
  }

  async function doDelete() {
    if (!deleteTarget) return;
    // Belt-and-suspenders: the menu items are already disabled for protected
    // branches, but guard here too in case a rule changed under an open dialog.
    if (isDeletionBlocked(rulesConfig, deleteTarget)) {
      toast.error(
        `${deleteTarget} is protected from deletion by a branch rule`,
      );
      setDeleteTarget(null);
      return;
    }
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

  function openCreate() {
    setOpen(false);
    createForm.reset(
      { name: "", base: currentName ?? defaultName ?? "" },
      { keepDefaultValues: true },
    );
    setCreateOpen(true);
  }

  // Pull the latest from the default branch into `target` without switching to
  // it (unless it's already current): fast-forwards when possible, otherwise
  // merges via a throwaway worktree so the working tree — and its watchers —
  // stay put. A conflicting merge aborts and reports rather than switching.
  function doUpdateFromDefault(target: string) {
    if (!defaultName || target === defaultName) return;
    setOpen(false);
    updateBranchFrom.mutate(
      { branch: target, base: defaultName },
      {
        onSuccess: (status) =>
          toast.success(
            status === "up-to-date"
              ? `${target} is already up to date with ${defaultName}`
              : `Updated ${target} from ${defaultName}`,
          ),
        onError,
      },
    );
  }

  const busy =
    checkout.isPending ||
    mergeBranch.isPending ||
    rebaseBranch.isPending ||
    updateBranchFrom.isPending;

  // Hotkey handlers reuse the menu's own flows, so every gate (clean tree,
  // stash count, picker availability) and confirm dialog applies equally.
  useHotkeyAction("show-branches", () => setOpen(true), !amending);
  useHotkeyAction("new-branch", openCreate);
  useHotkeyAction(
    "rename-branch",
    () => currentName && openRename(currentName),
    Boolean(currentName),
  );
  useHotkeyAction(
    "delete-branch",
    () => {
      setOpen(false);
      if (currentName) setDeleteTarget(currentName);
    },
    Boolean(currentName && !isDeletionBlocked(rulesConfig, currentName)),
  );
  useHotkeyAction(
    "update-from-default",
    () => currentName && doUpdateFromDefault(currentName),
    Boolean(defaultName && defaultName !== currentName && !busy),
  );
  useHotkeyAction(
    "merge-into-current",
    () => openPicker("merge"),
    otherBranches.length > 0 && canMergeIntoCurrent,
  );
  useHotkeyAction(
    "squash-merge-into-current",
    () => openPicker("squash"),
    otherBranches.length > 0 && canSquashIntoCurrent,
  );
  useHotkeyAction(
    "rebase-current",
    () => openPicker("rebase"),
    otherBranches.length > 0 && !lockCurrent,
  );
  useHotkeyAction("stash-all", () => setStashAllOpen(true), hasChanges);
  useHotkeyAction("pop-stash", () => setStashPopOpen(true), stashes > 0);
  useHotkeyAction("view-stashes", () => setStashesOpen(true), stashes > 0);
  useHotkeyAction("discard-all", () => setDiscardAllOpen(true), hasChanges);

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || amending}
              title={
                amending
                  ? "Finish or stop amending to switch branches"
                  : undefined
              }
            >
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
                {sortedBranches.map((branch) => {
                  const div = divByName.get(branch.name);
                  const canUpdate =
                    Boolean(defaultName) && branch.name !== defaultName;
                  const deletionBlocked = isDeletionBlocked(
                    rulesConfig,
                    branch.name,
                  );
                  return (
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
                              {branch.name === defaultName && (
                                <span className="ml-1.5 text-[10px] text-muted-foreground">
                                  default
                                </span>
                              )}
                            </span>
                            {div && (div.ahead > 0 || div.behind > 0) && (
                              <span
                                className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums"
                                title={`${div.ahead} ahead, ${div.behind} behind ${defaultName}`}
                              >
                                {div.ahead > 0 && (
                                  <span className="flex items-center gap-0.5">
                                    <ArrowUpIcon
                                      className="size-3"
                                      weight="bold"
                                    />
                                    {div.ahead}
                                  </span>
                                )}
                                {div.behind > 0 && (
                                  <span className="flex items-center gap-0.5">
                                    <ArrowDownIcon
                                      className="size-3"
                                      weight="bold"
                                    />
                                    {div.behind}
                                  </span>
                                )}
                              </span>
                            )}
                            {branch.lastCommitDate && (
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {formatRelativeTime(branch.lastCommitDate)}
                              </span>
                            )}
                            {branch.isCurrent && (
                              <CheckIcon className="size-3.5 shrink-0" />
                            )}
                          </button>
                        }
                      />
                      <ContextMenuContent className="min-w-48">
                        {canUpdate && (
                          <>
                            <ContextMenuItem
                              disabled={busy}
                              onClick={() => doUpdateFromDefault(branch.name)}
                            >
                              Update from {defaultName}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                          </>
                        )}
                        <ContextMenuItem
                          onClick={() => openRename(branch.name)}
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
                          disabled={deletionBlocked}
                          onClick={() => {
                            setOpen(false);
                            setDeleteTarget(branch.name);
                          }}
                        >
                          {deletionBlocked ? "Delete… (protected)" : "Delete…"}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
              <div className="border-t py-1">
                <MenuRow onClick={openCreate}>New branch…</MenuRow>
                <MenuRow
                  disabled={!currentName}
                  onClick={() => {
                    if (!currentName) return;
                    openRename(currentName);
                  }}
                >
                  Rename current branch…
                </MenuRow>
                <MenuRow
                  disabled={
                    !currentName || isDeletionBlocked(rulesConfig, currentName)
                  }
                  onClick={() => {
                    if (!currentName) return;
                    setOpen(false);
                    setDeleteTarget(currentName);
                  }}
                >
                  {currentName && isDeletionBlocked(rulesConfig, currentName)
                    ? "Delete current branch… (protected)"
                    : "Delete current branch…"}
                </MenuRow>
              </div>
              <div className="border-t py-1">
                <MenuRow
                  disabled={!hasChanges}
                  onClick={() => {
                    setOpen(false);
                    setDiscardAllOpen(true);
                  }}
                >
                  Discard all changes…
                </MenuRow>
                <MenuRow
                  disabled={!hasChanges}
                  onClick={() => {
                    setOpen(false);
                    setStashAllOpen(true);
                  }}
                >
                  Stash all changes…
                </MenuRow>
                <MenuRow
                  disabled={stashes === 0}
                  onClick={() => {
                    setOpen(false);
                    setStashPopOpen(true);
                  }}
                >
                  Pop latest stash{stashes > 0 ? ` (${stashes})` : ""}…
                </MenuRow>
                <MenuRow
                  disabled={stashes === 0}
                  onClick={() => {
                    setOpen(false);
                    setStashesOpen(true);
                  }}
                >
                  View stashes{stashes > 0 ? ` (${stashes})` : ""}…
                </MenuRow>
              </div>
              <div className="border-t py-1">
                <MenuRow
                  disabled={
                    !defaultName ||
                    !currentName ||
                    defaultName === currentName ||
                    busy
                  }
                  onClick={() =>
                    currentName && doUpdateFromDefault(currentName)
                  }
                >
                  Update from {defaultName ?? "default branch"}
                </MenuRow>
                <MenuRow
                  disabled={otherBranches.length === 0 || !canMergeIntoCurrent}
                  onClick={() => openPicker("merge")}
                >
                  {lockCurrent
                    ? "Merge into current branch… (requires PR)"
                    : "Merge into current branch…"}
                </MenuRow>
                <MenuRow
                  disabled={otherBranches.length === 0 || !canSquashIntoCurrent}
                  onClick={() => openPicker("squash")}
                >
                  Squash and merge into current branch…
                </MenuRow>
                <MenuRow
                  disabled={otherBranches.length === 0 || lockCurrent}
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
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              createForm.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>New branch</DialogTitle>
              <DialogDescription>
                Branches from{" "}
                <span className="font-mono">{createBase || "HEAD"}</span> and
                switches to it.
              </DialogDescription>
            </DialogHeader>
            <createForm.AppField
              name="name"
              validators={{
                onChange: ({ value }) =>
                  required(value) ??
                  branchNameError(rulesConfig, sanitizeRefName(value)) ??
                  undefined,
              }}
            >
              {(field) => (
                <field.TextField
                  label="Branch name"
                  placeholder="feature/my-change"
                  // Surface the branch-rules naming requirement (so a disabled
                  // Create button is explained), else the sanitization hint.
                  warning={(value) =>
                    branchNameHint(rulesConfig, sanitizeRefName(value)) ??
                    refNameWarning(value)
                  }
                />
              )}
            </createForm.AppField>
            {baseOptions.length > 0 && (
              <createForm.AppField name="base">
                {(field) => (
                  <field.SelectField
                    label="Base it on"
                    items={Object.fromEntries(
                      baseOptions.map((b) => [
                        b,
                        `${b}${b === currentName ? " (current)" : ""}${
                          b === defaultName ? " (default)" : ""
                        }`,
                      ]),
                    )}
                  />
                )}
              </createForm.AppField>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <createForm.AppForm>
                <createForm.SubmitButton>Create branch</createForm.SubmitButton>
              </createForm.AppForm>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              renameForm.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename branch</DialogTitle>
              <DialogDescription>Renames {renameTarget}.</DialogDescription>
            </DialogHeader>
            <renameForm.AppField
              name="name"
              validators={{
                onChange: ({ value }) =>
                  required(value) ??
                  (sanitizeRefName(value) === renameTarget
                    ? "Unchanged"
                    : undefined),
              }}
            >
              {(field) => (
                <field.TextField label="New name" warning={refNameWarning} />
              )}
            </renameForm.AppField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameTarget(null)}
              >
                Cancel
              </Button>
              <renameForm.AppForm>
                <renameForm.SubmitButton>Rename</renameForm.SubmitButton>
              </renameForm.AppForm>
            </DialogFooter>
          </form>
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

      <StashesDialog
        repoPath={repoPath}
        open={stashesOpen}
        onOpenChange={setStashesOpen}
      />

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

      <Dialog open={stashAllOpen} onOpenChange={setStashAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stash all changes?</DialogTitle>
            <DialogDescription>
              Sets your working tree back to the last commit and saves all
              uncommitted changes — including untracked files — to the stash.
              "Pop latest stash" restores them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStashAllOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={stashAll.isPending}
              onClick={() =>
                stashAll.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Changes stashed");
                    setStashAllOpen(false);
                  },
                  onError: (e) => {
                    onError(e);
                    setStashAllOpen(false);
                  },
                })
              }
            >
              Stash changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stashPopOpen} onOpenChange={setStashPopOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pop latest stash?</DialogTitle>
            <DialogDescription>
              Applies the most recent stash to your working tree and removes it
              from the stash list. If applying conflicts, the stash is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStashPopOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={stashPop.isPending}
              onClick={() =>
                stashPop.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Stash restored");
                    setStashPopOpen(false);
                  },
                  onError: (e) => {
                    onError(e);
                    setStashPopOpen(false);
                  },
                })
              }
            >
              Pop stash
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

      <Dialog
        open={switchTarget !== null}
        onOpenChange={(o) => {
          if (!o) setSwitchTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>You have changes in progress</DialogTitle>
            <DialogDescription>
              Bring your uncommitted changes along to {switchTarget}, or stash
              them so {currentLabel} stays as you left it. "Pop latest stash"
              restores stashed changes later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwitchTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={stashAll.isPending || checkout.isPending}
              onClick={stashAndSwitch}
            >
              Stash and switch
            </Button>
            <Button disabled={checkout.isPending} onClick={bringAndSwitch}>
              Bring changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
