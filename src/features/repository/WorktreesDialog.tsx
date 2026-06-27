import {
  CaretLeftIcon,
  DotsThreeVerticalIcon,
  FolderOpenIcon,
  GitBranchIcon,
  LockSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { MouseEvent } from "react";
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  useAddUserWorktree,
  useBranches,
  useRemoveUserWorktree,
  useRepoStatus,
  useUserWorktrees,
} from "@/lib/git/queries";
import type { UserWorktree } from "@/lib/git/worktree";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useOpenWorktree } from "./useOpenRepoByPath";

/** Lower-cased, forward-slashed path — git emits "/", the app stores "\" on
 *  Windows. Mirrors the backend's `normalize_wt_path` so "current" detection and
 *  default-path derivation compare apples to apples. */
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

/** Sets a hover title only when a Select item is actually clipped. Base UI pins
 *  the popup to the trigger width and clips `overflow-x`, and the inner item text
 *  is `whitespace-nowrap`, so the truncation lives on the ITEM element — measure
 *  `currentTarget`, not an inner span (a span-level check never fires). */
const clipTitle = (value: string) => (e: MouseEvent<HTMLElement>) => {
  const el = e.currentTarget;
  el.title = el.scrollWidth > el.clientWidth ? value : "";
};

/**
 * The user-facing Git worktree manager. Lists the repo's worktrees (agent-session
 * ones are filtered out by the backend), switches the active repo to one, removes
 * them safely, and creates new ones via an inline form. Opened from the repo ⋯
 * menu and the command palette.
 */
export function WorktreesDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<"list" | "create">("list");

  // Always reset to the list when the dialog reopens.
  function handleOpenChange(next: boolean) {
    if (next) setMode("list");
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {mode === "create" ? (
          <CreateWorktree
            repoPath={repoPath}
            onCancel={() => setMode("list")}
            onCreated={() => setMode("list")}
          />
        ) : (
          <WorktreeList
            repoPath={repoPath}
            open={open}
            onAdd={() => setMode("create")}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------- list mode

function WorktreeList({
  repoPath,
  open,
  onAdd,
  onClose,
}: {
  repoPath: string;
  open: boolean;
  onAdd: () => void;
  onClose: () => void;
}) {
  const worktrees = useUserWorktrees(repoPath, open);
  const openWorktree = useOpenWorktree();
  const activeRepo = useUiStore((s) => s.repoPath);
  const activeNorm = activeRepo ? norm(activeRepo) : "";

  const [highlight, setHighlight] = useState(-1);
  const [deleteTarget, setDeleteTarget] = useState<UserWorktree | null>(null);

  const list = worktrees.data ?? [];
  const linkedCount = list.filter((w) => !w.isMain).length;

  const onKeyDown = listKeyboardNav({
    items: list,
    activeIndex: highlight,
    onActivate: (_w, to) => setHighlight(to),
    rowKey: (w) => w.path,
    rowAttr: "data-wt-path",
  });

  async function handleOpen(w: UserWorktree) {
    if (norm(w.path) === activeNorm) return; // already here
    await openWorktree(w.path);
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Worktrees</DialogTitle>
        <DialogDescription>
          Each worktree checks out a different branch into its own folder, so
          you can work on several at once without stashing or switching. Opening
          one makes it the active repository.
        </DialogDescription>
      </DialogHeader>

      {/* min-w-0: DialogContent is a grid; without it this grid item grows to
          fit a long worktree path instead of letting the rows truncate. */}
      <div className="min-w-0 border">
        <div
          role="listbox"
          aria-label="Worktrees"
          onKeyDown={onKeyDown}
          className="max-h-80 overflow-y-auto"
        >
          {worktrees.isPending ? (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          ) : (
            list.map((w, i) => (
              <WorktreeRow
                key={w.path}
                worktree={w}
                highlighted={i === highlight}
                isCurrent={norm(w.path) === activeNorm}
                onFocus={() => setHighlight(i)}
                onOpen={() => handleOpen(w)}
                onDelete={() => setDeleteTarget(w)}
              />
            ))
          )}
        </div>
        {!worktrees.isPending && linkedCount === 0 && (
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            No additional worktrees yet. Add one to work on another branch in
            its own folder.
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onAdd}>
          <PlusIcon data-icon="inline-start" />
          Add worktree
        </Button>
      </DialogFooter>

      <DeleteWorktreeDialog
        key={deleteTarget?.path ?? "none"}
        repoPath={repoPath}
        worktree={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}

function WorktreeRow({
  worktree,
  highlighted,
  isCurrent,
  onFocus,
  onOpen,
  onDelete,
}: {
  worktree: UserWorktree;
  highlighted: boolean;
  isCurrent: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { path, branch, isMain, isDetached, isLocked, lockReason } = worktree;

  return (
    <div
      data-highlighted={highlighted || undefined}
      className={cn(
        "flex items-center gap-1 border-b last:border-b-0",
        isCurrent
          ? "bg-accent"
          : highlighted
            ? "bg-muted"
            : "hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={highlighted}
        // Not `disabled`: the current row must stay focusable so arrow-key nav
        // can move through it. onOpen already no-ops on the current worktree.
        aria-disabled={isCurrent || undefined}
        data-wt-path={path}
        onFocus={onFocus}
        onClick={onOpen}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left",
          isCurrent && "cursor-default",
        )}
        title={isCurrent ? "Current worktree" : "Open this worktree"}
      >
        <GitBranchIcon
          weight={isCurrent ? "fill" : "regular"}
          className={cn(
            "size-3.5 shrink-0",
            isCurrent ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-xs font-medium">
              {isDetached ? "detached HEAD" : branch || "—"}
            </span>
            <RowTags
              isMain={isMain}
              isCurrent={isCurrent}
              isDetached={isDetached}
              isLocked={isLocked}
              lockReason={lockReason}
            />
          </span>
          <span
            className="mt-0.5 block truncate text-[11px] text-muted-foreground"
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.title = el.scrollWidth > el.clientWidth ? path : "";
            }}
          >
            {path}
          </span>
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="mr-1 shrink-0"
              aria-label={`Actions for ${branch || path}`}
            />
          }
        >
          <DotsThreeVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem disabled={isCurrent} onClick={onOpen}>
            <FolderOpenIcon />
            {isCurrent ? "Current worktree" : "Open worktree"}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            // Can't delete the main worktree, nor the one you're standing in
            // (it'd leave the app pointing at a removed folder) — switch away first.
            disabled={isMain || isCurrent}
            onClick={onDelete}
          >
            <TrashIcon />
            Delete worktree…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RowTags({
  isMain,
  isCurrent,
  isDetached,
  isLocked,
  lockReason,
}: {
  isMain: boolean;
  isCurrent: boolean;
  isDetached: boolean;
  isLocked: boolean;
  lockReason: string;
}) {
  return (
    <>
      {isMain && (
        <Badge variant="secondary" className="shrink-0">
          Main
        </Badge>
      )}
      {isCurrent && (
        <Badge variant="outline" className="shrink-0 text-primary">
          Current
        </Badge>
      )}
      {isDetached && (
        <Badge variant="outline" className="shrink-0">
          Detached
        </Badge>
      )}
      {isLocked && (
        <Badge
          variant="outline"
          className="shrink-0 text-warning"
          title={lockReason ? `Locked: ${lockReason}` : "Locked"}
        >
          <LockSimpleIcon data-icon="inline-start" />
          Locked
        </Badge>
      )}
    </>
  );
}

// --------------------------------------------------------------- delete confirm

function DeleteWorktreeDialog({
  repoPath,
  worktree,
  onClose,
}: {
  repoPath: string;
  worktree: UserWorktree | null;
  onClose: () => void;
}) {
  const remove = useRemoveUserWorktree(repoPath);
  // A locked worktree always needs --force; a dirty one reveals it on first try.
  const [forceNeeded, setForceNeeded] = useState(worktree?.isLocked ?? false);

  function doRemove(force: boolean) {
    if (!worktree) return;
    remove.mutate(
      { path: worktree.path, force },
      {
        onSuccess: () => {
          toast.success("Worktree removed");
          onClose();
        },
        onError: (e) => {
          const msg = String((e as { message?: string })?.message ?? e);
          // git refuses a non-force remove of a dirty/locked worktree; surface
          // the escalation rather than failing silently.
          if (!force && /force|modified|untracked|locked/i.test(msg)) {
            setForceNeeded(true);
          } else {
            toastError(e);
          }
        },
      },
    );
  }

  return (
    <Dialog open={worktree !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this worktree?</DialogTitle>
          <DialogDescription>
            Removes the worktree folder. Its branch{" "}
            {worktree?.branch ? (
              <span className="font-mono">{worktree.branch}</span>
            ) : (
              "and commits"
            )}{" "}
            stays — you can check it out again later.
          </DialogDescription>
        </DialogHeader>

        <p className="truncate rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
          {worktree?.path}
        </p>

        {worktree?.isLocked && (
          <p className="text-xs text-warning">
            This worktree is locked
            {worktree.lockReason ? ` (${worktree.lockReason})` : ""}. Removing
            it forces it.
          </p>
        )}
        {forceNeeded && !worktree?.isLocked && (
          <p className="text-xs text-warning">
            This worktree has uncommitted changes. Force-removing discards them.
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={remove.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => doRemove(forceNeeded)}
          >
            {remove.isPending && <Spinner data-icon="inline-start" />}
            {forceNeeded ? "Force remove" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- create mode

function CreateWorktree({
  repoPath,
  onCancel,
  onCreated,
}: {
  repoPath: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const worktrees = useUserWorktrees(repoPath);
  const branchesQuery = useBranches(repoPath);
  const status = useRepoStatus(repoPath);
  const add = useAddUserWorktree(repoPath);

  const list = worktrees.data ?? [];
  const mainPath = list.find((w) => w.isMain)?.path ?? repoPath;
  const checkedOut = new Set(
    list.map((w) => w.branch).filter((b): b is string => Boolean(b)),
  );
  // Hide the app-internal agent-session branches — they're never something a
  // user picks as a base or checks out into a manual worktree.
  const branches = (branchesQuery.data ?? []).filter(
    (b) => !b.name.startsWith("gd/session/"),
  );
  const available = branches.filter((b) => !checkedOut.has(b.name));
  const currentBranch = status.data?.branch.name ?? "";

  const [source, setSource] = useState<"new" | "existing">("new");
  const [newBranch, setNewBranch] = useState("");
  const [base, setBase] = useState(currentBranch || "HEAD");
  const [existing, setExisting] = useState("");
  const [path, setPath] = useState("");
  // Stop auto-deriving the path once the user edits it by hand.
  const [pathEdited, setPathEdited] = useState(false);

  const branch = source === "new" ? newBranch.trim() : existing;

  // Default the folder to a sibling of the main worktree, named for the branch,
  // until the user takes the path field over.
  const derivedPath = deriveSiblingPath(mainPath, branch);
  const effectivePath = pathEdited ? path : derivedPath;

  const missing =
    !branch || !effectivePath
      ? source === "new"
        ? "Enter a branch name and folder to continue."
        : "Pick a branch and folder to continue."
      : "";

  function handleCreate() {
    add.mutate(
      {
        path: effectivePath,
        branch,
        newBranch: source === "new",
        baseRef: source === "new" ? base : undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Worktree created on ${branch}`);
          onCreated();
        },
        onError: toastError,
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label="Back to worktrees"
          >
            <CaretLeftIcon />
          </Button>
          <DialogTitle>New worktree</DialogTitle>
        </div>
        <DialogDescription>
          Check out a branch into a new folder. The branch can't already be
          checked out in another worktree.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <RadioGroup
          value={source}
          onValueChange={(v) => setSource(v as "new" | "existing")}
          className="flex gap-4 text-xs"
        >
          <label className="flex cursor-pointer items-center gap-1.5">
            <Radio value="new" />
            New branch
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <Radio value="existing" />
            Existing branch
          </label>
        </RadioGroup>

        {source === "new" ? (
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
            <label htmlFor="wt-new-branch" className="text-muted-foreground">
              Branch name
            </label>
            <Input
              id="wt-new-branch"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="feature/login"
              className="h-7 font-mono"
            />
            <label htmlFor="wt-base" className="text-muted-foreground">
              Based on
            </label>
            <Select value={base} onValueChange={(v) => v && setBase(v)}>
              <SelectTrigger id="wt-base" size="sm" className="font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currentBranch &&
                  !branches.some((b) => b.name === currentBranch) && (
                    <SelectItem
                      value={currentBranch}
                      onMouseEnter={clipTitle(currentBranch)}
                    >
                      {currentBranch}
                    </SelectItem>
                  )}
                {branches.map((b) => (
                  <SelectItem
                    key={b.name}
                    value={b.name}
                    onMouseEnter={clipTitle(b.name)}
                  >
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
            <label htmlFor="wt-existing" className="text-muted-foreground">
              Branch
            </label>
            {available.length === 0 ? (
              <p className="text-muted-foreground">
                Every branch is already checked out in a worktree.
              </p>
            ) : (
              <Select
                value={existing}
                onValueChange={(v) => v && setExisting(v)}
              >
                <SelectTrigger id="wt-existing" size="sm" className="font-mono">
                  <SelectValue placeholder="Select a branch" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((b) => (
                    <SelectItem
                      key={b.name}
                      value={b.name}
                      onMouseEnter={clipTitle(b.name)}
                    >
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 text-xs">
          <label htmlFor="wt-path" className="text-muted-foreground">
            Folder
          </label>
          <Input
            id="wt-path"
            autoComplete="off"
            spellCheck={false}
            value={effectivePath}
            onChange={(e) => {
              setPath(e.target.value);
              setPathEdited(true);
            }}
            placeholder="Path for the new worktree"
            className="h-7 font-mono"
          />
        </div>
      </div>

      <DialogFooter className="items-center">
        {missing && (
          <span className="mr-auto text-[11px] text-muted-foreground">
            {missing}
          </span>
        )}
        <Button variant="outline" onClick={onCancel} disabled={add.isPending}>
          Cancel
        </Button>
        <Button
          disabled={Boolean(missing) || add.isPending}
          onClick={handleCreate}
        >
          {add.isPending && <Spinner data-icon="inline-start" />}
          Create worktree
        </Button>
      </DialogFooter>
    </>
  );
}

/** A sibling folder of the main worktree named for the branch:
 *  `<parent>/<repo>-<branch>` (branch slashes flattened to dashes). */
function deriveSiblingPath(mainPath: string, branch: string): string {
  if (!mainPath) return "";
  const base = mainPath.replace(/[/\\]+$/, "");
  const slash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  const parent = slash >= 0 ? base.slice(0, slash) : base;
  const name = slash >= 0 ? base.slice(slash + 1) : base;
  const safe = branch.trim().replace(/[\\/]+/g, "-");
  if (!safe) return "";
  return `${parent}/${name}-${safe}`;
}
