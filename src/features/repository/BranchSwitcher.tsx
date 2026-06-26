import { Popover } from "@base-ui/react/popover";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CheckIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { Spinner } from "@/components/ui/spinner";
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
  useGhStatus,
  useMergeBranch,
  usePrList,
  useRebaseBranch,
  useRenameBranch,
  useRepoStatus,
  useSetBranchArchived,
  useStashAll,
  useStashCount,
  useStashPop,
  useUpdateBranchFrom,
} from "@/lib/git/queries";
import { refNameWarning, sanitizeRefName } from "@/lib/git/ref-name";
import type { Branch } from "@/lib/git/types";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useLocalPrs } from "@/lib/pulls/queries";
import { useAiConfigured, useAiEnabled } from "@/lib/settings/queries";
import { type SelectedPr, useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { StashesDialog } from "./StashesDialog";
import { useGenerateBranchName } from "./useGenerateBranchName";

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

type PrState = "open" | "draft" | "merged" | "closed";

interface BranchPr {
  state: PrState;
  /** "#123" for a remote PR, "local" for a local-only one. */
  label: string;
  select: SelectedPr;
}

// When a branch has several PRs, the most actionable state wins.
const PR_RANK: Record<PrState, number> = {
  open: 3,
  draft: 3,
  merged: 2,
  closed: 1,
};

// GitHub's PR-state palette, in the app's `text-…-600 dark:text-…-400` idiom.
const PR_TONE: Record<PrState, string> = {
  open: "text-green-600 dark:text-green-400",
  draft: "text-muted-foreground",
  merged: "text-purple-600 dark:text-purple-400",
  closed: "text-red-600 dark:text-red-400",
};

const PR_STATE_LABEL: Record<PrState, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
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
  const setBranchArchived = useSetBranchArchived(repoPath);
  const rulesConfig = useEffectiveBranchRules(repoPath);
  const amendingHash = useUiStore((s) => s.amendingHash);
  const openSettings = useUiStore((s) => s.openSettings);
  const aiEnabled = useAiEnabled();
  const aiConfigured = useAiConfigured();
  const branchNameGen = useGenerateBranchName(repoPath);

  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  // The branch row the keyboard nav last landed on (drives arrow-key movement).
  const [activeBranch, setActiveBranch] = useState<string | null>(null);
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
  // Archived branches are hidden from the list and the merge picker.
  const otherBranches = allBranches.filter((b) => !b.isCurrent && !b.archived);
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
  const divByName = useMemo(
    () => new Map((divergence.data ?? []).map((d) => [d.name, d] as const)),
    [divergence.data],
  );

  // Per-branch PR badge. Remote PRs (open + closed, the latter carrying merged)
  // and local PRs, fetched only while the menu is open and the repo has a
  // GitHub remote — mirrors the divergence gate above.
  const gh = useGhStatus(repoPath);
  const canGh = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const openPrs = usePrList(repoPath, canGh && open, "open");
  const closedPrs = usePrList(repoPath, canGh && open, "closed");
  const localPrs = useLocalPrs(repoPath);
  const selectPr = useUiStore((s) => s.selectPr);
  const setRepoTab = useUiStore((s) => s.setRepoTab);

  const prByBranch = useMemo(() => {
    const map = new Map<string, BranchPr>();
    const consider = (branchName: string, cand: BranchPr) => {
      const cur = map.get(branchName);
      if (!cur || PR_RANK[cand.state] > PR_RANK[cur.state]) {
        map.set(branchName, cand);
      }
    };
    // Remote PRs first, so they win ties against a local PR of equal state.
    for (const pr of [...(openPrs.data ?? []), ...(closedPrs.data ?? [])]) {
      const state: PrState =
        pr.isDraft && pr.state === "OPEN"
          ? "draft"
          : pr.state === "MERGED"
            ? "merged"
            : pr.state === "CLOSED"
              ? "closed"
              : "open";
      consider(pr.headRefName, {
        state,
        label: `#${pr.number}`,
        select: { kind: "remote", id: String(pr.number) },
      });
    }
    for (const pr of localPrs.data ?? []) {
      const state: PrState =
        pr.status === "merged"
          ? "merged"
          : pr.status === "closed"
            ? "closed"
            : "open";
      consider(pr.head, {
        state,
        label: "local",
        select: { kind: "local", id: pr.id },
      });
    }
    return map;
  }, [openPrs.data, closedPrs.data, localPrs.data]);

  const openPr = (select: SelectedPr) => {
    selectPr(select);
    setRepoTab("pulls");
    setOpen(false);
  };
  // Default branch pinned on top, then the rest by most recently committed.
  // Memoized: the compiler won't hoist the `.sort()` copy or the filter
  // allocations, and these recompute on every filter keystroke otherwise.
  const sortedBranches = useMemo(
    () =>
      [...allBranches].sort((a, b) => {
        if (a.name === defaultName) return -1;
        if (b.name === defaultName) return 1;
        return b.lastCommitDate.localeCompare(a.lastCommitDate);
      }),
    [allBranches, defaultName],
  );
  const bq = branchFilter.trim().toLowerCase();
  const visibleBranches = useMemo(
    () =>
      sortedBranches.filter(
        (b) => !b.archived && (!bq || b.name.toLowerCase().includes(bq)),
      ),
    [sortedBranches, bq],
  );
  const archivedBranches = useMemo(
    () =>
      sortedBranches.filter(
        (b) => b.archived && (!bq || b.name.toLowerCase().includes(bq)),
      ),
    [sortedBranches, bq],
  );
  // Arrow-key navigation over the visible rows (+ archived when expanded) so
  // keyboard users can move through branches instead of Tabbing each one. Enter
  // on the focused row checks it out via the row button's native click.
  const navBranches = [
    ...visibleBranches,
    ...(showArchived ? archivedBranches : []),
  ];
  const onBranchKeyDown = listKeyboardNav({
    items: navBranches,
    activeIndex: navBranches.findIndex((b) => b.name === activeBranch),
    onActivate: (b) => setActiveBranch(b.name),
    rowKey: (b) => b.name,
  });
  const stashes = stashCount.data ?? 0;
  const hasChanges = (status.data?.entries.length ?? 0) > 0;
  // Naming a branch from changes needs a commit to diff against; an unborn HEAD
  // (no commits) has nothing to compare the working tree to.
  const headExists = Boolean(head?.oid);
  // You can't amend across branches: amend mode targets a specific commit on
  // this branch, so switching would strand the in-progress amend and leave its
  // banner up. Lock the switcher until the user finishes or stops amending.
  const amending = amendingHash !== null;
  // Bases offered when creating a branch: the current branch and/or the
  // default branch (deduped — they're the same when you're on the default).
  const baseOptions = useMemo(
    () => [
      ...new Set(
        [currentName, defaultName].filter((b): b is string => Boolean(b)),
      ),
    ],
    [currentName, defaultName],
  );

  const onError = (e: unknown) => toastError(e);

  function setArchived(name: string, archived: boolean) {
    setBranchArchived.mutate(
      { name, archived },
      {
        onSuccess: () =>
          toast.success(archived ? `Archived ${name}` : `Unarchived ${name}`),
        onError,
      },
    );
  }

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

  // Shared by the visible list and the Archived section.
  const renderBranchRow = (branch: Branch) => {
    const div = divByName.get(branch.name);
    const canUpdate = Boolean(defaultName) && branch.name !== defaultName;
    const deletionBlocked = isDeletionBlocked(rulesConfig, branch.name);
    return (
      <ContextMenu key={branch.name}>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              data-row={branch.name}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
              onClick={() => {
                if (!branch.isCurrent) switchTo(branch.name);
              }}
            >
              <span
                className="min-w-0 flex-1 truncate"
                // Only expose the full name as a tooltip when it's actually
                // clipped — measured just-in-time on hover, so no per-row refs.
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.title = el.scrollWidth > el.clientWidth ? branch.name : "";
                }}
              >
                {branch.name}
                {branch.name === defaultName && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    default
                  </span>
                )}
              </span>
              {(() => {
                const pr = prByBranch.get(branch.name);
                if (!pr) return null;
                const isLocal = pr.select.kind === "local";
                return (
                  <span
                    role="button"
                    tabIndex={0}
                    title={
                      isLocal
                        ? `${PR_STATE_LABEL[pr.state]} local pull request — open in Pull Requests`
                        : `${PR_STATE_LABEL[pr.state]} pull request ${pr.label} — open in Pull Requests`
                    }
                    className={cn(
                      "flex shrink-0 cursor-pointer items-center gap-0.5 text-[11px] tabular-nums hover:underline",
                      PR_TONE[pr.state],
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      openPr(pr.select);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        openPr(pr.select);
                      }
                    }}
                  >
                    <GitPullRequestIcon className="size-3" weight="bold" />
                    {pr.label}
                  </span>
                );
              })()}
              {div && (div.ahead > 0 || div.behind > 0) && (
                <span
                  className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums"
                  title={`${div.ahead} ahead, ${div.behind} behind ${defaultName}`}
                >
                  {div.ahead > 0 && (
                    <span className="flex items-center gap-0.5">
                      <ArrowUpIcon className="size-3" weight="bold" />
                      {div.ahead}
                    </span>
                  )}
                  {div.behind > 0 && (
                    <span className="flex items-center gap-0.5">
                      <ArrowDownIcon className="size-3" weight="bold" />
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
              {branch.isCurrent && <CheckIcon className="size-3.5 shrink-0" />}
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
          <ContextMenuItem onClick={() => openRename(branch.name)}>
            Rename…
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => copyText(branch.name, "Branch name copied")}
          >
            Copy branch name
          </ContextMenuItem>
          <ContextMenuItem
            disabled={branch.isCurrent}
            onClick={() => setArchived(branch.name, !branch.archived)}
          >
            {branch.archived ? "Unarchive" : "Archive"}
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
  };

  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setBranchFilter("");
            setActiveBranch(null);
          }
        }}
      >
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
            <Popover.Popup
              className="w-108 rounded-none bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
              // Arrow keys move through the branch rows whether focus is on the
              // filter input, a row, or the popup itself (Esc/Tab pass through).
              onKeyDown={onBranchKeyDown}
            >
              <div className="border-b p-2">
                <Input
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  placeholder="Filter branches"
                  className="h-7"
                  autoComplete="off"
                />
              </div>
              <div className="max-h-60 overflow-y-auto">
                {visibleBranches.length === 0 &&
                  archivedBranches.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      No branches match "{branchFilter.trim()}"
                    </p>
                  )}
                {visibleBranches.map(renderBranchRow)}
                {archivedBranches.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      onClick={() => setShowArchived((v) => !v)}
                    >
                      <CaretDownIcon
                        className={`size-3 transition-transform ${
                          showArchived ? "" : "-rotate-90"
                        }`}
                        weight="bold"
                      />
                      Archived ({archivedBranches.length})
                    </button>
                    {showArchived && archivedBranches.map(renderBranchRow)}
                  </>
                )}
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
            {aiEnabled && (
              <div className="flex justify-end">
                {!aiConfigured ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    title="Connect an AI provider to generate branch names"
                    onClick={() => {
                      setCreateOpen(false);
                      openSettings("ai");
                    }}
                  >
                    <SparkleIcon data-icon="inline-start" />
                    Set up AI to name branches
                  </Button>
                ) : branchNameGen.generating ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={branchNameGen.cancel}
                  >
                    <Spinner data-icon="inline-start" />
                    Generating…
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    disabled={!hasChanges || !headExists}
                    title={
                      !headExists
                        ? "Make your first commit before branching from changes"
                        : !hasChanges
                          ? "No in-progress changes — make some edits to name a branch after them"
                          : "Suggest a name from your in-progress changes"
                    }
                    onClick={() =>
                      branchNameGen.generate({
                        entries: status.data?.entries ?? [],
                        recentBranches: allBranches
                          .map((b) => b.name)
                          .slice(0, 20),
                        onName: (name) =>
                          createForm.setFieldValue("name", name),
                      })
                    }
                  >
                    <SparkleIcon data-icon="inline-start" />
                    Generate from changes
                  </Button>
                )}
              </div>
            )}
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

      <ConfirmDialog
        open={deleteTarget !== null}
        onCancel={() => setDeleteTarget(null)}
        title="Delete branch?"
        body={
          <>
            Deletes {deleteTarget} locally, including commits that exist only on
            it.
            {deleteTarget === currentName &&
              " You'll be switched to another branch first."}
          </>
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        pending={deleteBranch.isPending || checkout.isPending}
        onConfirm={doDelete}
      />

      <StashesDialog
        repoPath={repoPath}
        open={stashesOpen}
        onOpenChange={setStashesOpen}
      />

      <ConfirmDialog
        open={discardAllOpen}
        onCancel={() => setDiscardAllOpen(false)}
        title="Discard all changes?"
        body="All uncommitted changes are discarded: tracked files reset to the last commit, untracked files move to the recycle bin."
        confirmLabel="Discard all"
        confirmVariant="destructive"
        pending={discardAll.isPending}
        onConfirm={() =>
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
      />

      <ConfirmDialog
        open={stashAllOpen}
        onCancel={() => setStashAllOpen(false)}
        title="Stash all changes?"
        body={
          'Sets your working tree back to the last commit and saves all uncommitted changes — including untracked files — to the stash. "Pop latest stash" restores them.'
        }
        confirmLabel="Stash changes"
        pending={stashAll.isPending}
        onConfirm={() =>
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
      />

      <ConfirmDialog
        open={stashPopOpen}
        onCancel={() => setStashPopOpen(false)}
        title="Pop latest stash?"
        body="Applies the most recent stash to your working tree and removes it from the stash list. If applying conflicts, the stash is kept."
        confirmLabel="Pop stash"
        pending={stashPop.isPending}
        onConfirm={() =>
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
      />

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
