import {
  ArrowSquareOutIcon,
  FilesIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateLocalPrDialog } from "@/features/pulls/CreateLocalPrDialog";
import { CreatePrDialog } from "@/features/pulls/CreatePrDialog";
import {
  useBranches,
  useCompareBranches,
  useDefaultBranch,
  useGhStatus,
  useHoverPrefetch,
  usePrefetchCommit,
  usePrsForBranch,
  useRepoStatus,
} from "@/lib/git/queries";
import type { CommitSummary } from "@/lib/git/types";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export function ComparePanel({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const branches = useBranches(repoPath);
  const defaultBranch = useDefaultBranch(repoPath);
  const gh = useGhStatus(repoPath);
  const compareBranch = useUiStore((s) => s.compareBranch);
  const setCompareBranch = useUiStore((s) => s.setCompareBranch);
  const selectedCommitHash = useUiStore((s) => s.selectedCommitHash);
  const selectCommit = useUiStore((s) => s.selectCommit);
  const prefetchCommit = usePrefetchCommit(repoPath);
  const hoverPrefetch = useHoverPrefetch();
  const onHoverCommit = (hash: string) =>
    hoverPrefetch(() => prefetchCommit(hash));
  const [prOpen, setPrOpen] = useState(false);
  const [localPrOpen, setLocalPrOpen] = useState(false);

  const currentName = status.data?.branch?.name ?? null;
  const detached = status.data?.branch?.detached ?? false;
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const branchPrs = usePrsForBranch(repoPath, currentName, ghReady);
  const otherBranches = (branches.data ?? []).filter((b) => !b.isCurrent);
  const firstOther = otherBranches[0]?.name ?? null;
  const compareValid =
    compareBranch !== null &&
    otherBranches.some((b) => b.name === compareBranch);
  const defaultName = defaultBranch.data ?? null;

  // Show the aggregate diff first, not a stale commit from another tab.
  useEffect(() => {
    selectCommit(null);
  }, [selectCommit]);
  // Default the comparison to the default branch, else the first other branch.
  useEffect(() => {
    if (firstOther === null || compareValid) return;
    setCompareBranch(
      defaultName && defaultName !== currentName ? defaultName : firstOther,
    );
  }, [firstOther, compareValid, defaultName, currentName, setCompareBranch]);

  const comparison = useCompareBranches(repoPath, compareBranch, currentName);

  const ahead = comparison.data?.ahead ?? [];
  const behind = comparison.data?.behind ?? [];
  const canPr = ghReady;
  // An open PR from the current branch into the compared branch already exists.
  const existingPr = (branchPrs.data ?? []).find(
    (p) => p.baseRefName === compareBranch,
  );

  useHotkeyAction(
    "create-pr",
    () => setPrOpen(true),
    Boolean(canPr && compareBranch && !existingPr && ahead.length > 0),
  );
  useHotkeyAction(
    "create-local-pr",
    () => setLocalPrOpen(true),
    Boolean(compareBranch && compareBranch !== currentName && ahead.length > 0),
  );

  if (detached || !currentName) {
    return (
      <p className="flex-1 px-3 py-8 text-center text-xs text-muted-foreground">
        Compare needs a checked-out branch. You're on a detached HEAD.
      </p>
    );
  }
  if (otherBranches.length === 0) {
    return (
      <p className="flex-1 px-3 py-8 text-center text-xs text-muted-foreground">
        No other branches to compare against.
      </p>
    );
  }

  // Arrow keys walk "All changes" → ahead → behind, mirroring the list.
  const navTargets: (string | null)[] = [
    null,
    ...ahead.map((c) => c.hash),
    ...behind.map((c) => c.hash),
  ];

  const onListKeyDown = listKeyboardNav({
    items: navTargets,
    activeIndex: navTargets.indexOf(selectedCommitHash),
    onActivate: (target) => selectCommit(target),
    rowKey: (target) => target ?? "all",
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-1.5 border-b p-2">
        <p className="px-1 text-xs text-muted-foreground">
          Compare <span className="font-mono">{currentName}</span> with
        </p>
        <Select
          items={Object.fromEntries(otherBranches.map((b) => [b.name, b.name]))}
          value={compareBranch || null}
          onValueChange={(v) => v && setCompareBranch(v)}
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
        {canPr && compareBranch && existingPr && (
          <Button
            variant="outline"
            size="sm"
            className="w-full cursor-pointer"
            onClick={() => openUrl(existingPr.url)}
            title={existingPr.title}
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            View pull request #{existingPr.number}
            {existingPr.isDraft ? " (draft)" : ""}
          </Button>
        )}
        {canPr && compareBranch && !existingPr && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={ahead.length === 0}
            onClick={() => setPrOpen(true)}
            title={
              ahead.length === 0
                ? `${currentName} has no commits to propose onto ${compareBranch}`
                : `Open a pull request into ${compareBranch}`
            }
          >
            <GitPullRequestIcon data-icon="inline-start" />
            Create pull request…
          </Button>
        )}
        {compareBranch && compareBranch !== currentName && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={ahead.length === 0}
            onClick={() => setLocalPrOpen(true)}
            title={`Propose merging ${currentName} into ${compareBranch} locally`}
          >
            <GitBranchIcon data-icon="inline-start" />
            Create local PR…
          </Button>
        )}
      </div>

      {canPr && compareBranch && !existingPr && (
        <CreatePrDialog
          repoPath={repoPath}
          defaultBase={compareBranch}
          defaultHead={currentName}
          open={prOpen}
          onOpenChange={setPrOpen}
        />
      )}
      {compareBranch && (
        <CreateLocalPrDialog
          repoPath={repoPath}
          defaultBase={compareBranch}
          defaultHead={currentName}
          open={localPrOpen}
          onOpenChange={setLocalPrOpen}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onListKeyDown}>
        <button
          type="button"
          data-row="all"
          className={cn(
            "flex w-full shrink-0 items-center gap-2 border-b px-3 py-2 text-left text-xs",
            selectedCommitHash === null
              ? "bg-accent text-accent-foreground"
              : "hover:bg-muted/60",
          )}
          onClick={() => selectCommit(null)}
        >
          <FilesIcon className="size-3.5 shrink-0" />
          <span className="font-medium">All changes</span>
        </button>

        {comparison.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <CommitSection
              title={`${ahead.length} ahead`}
              subtitle={`on ${currentName}, not on ${compareBranch}`}
              commits={ahead}
              selectedHash={selectedCommitHash}
              onSelect={selectCommit}
              onHover={onHoverCommit}
            />
            <CommitSection
              title={`${behind.length} behind`}
              subtitle={`on ${compareBranch}, not on ${currentName}`}
              commits={behind}
              selectedHash={selectedCommitHash}
              onSelect={selectCommit}
              onHover={onHoverCommit}
            />
            {ahead.length === 0 && behind.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                These branches are even.
              </p>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function CommitSection({
  title,
  subtitle,
  commits,
  selectedHash,
  onSelect,
  onHover,
}: {
  title: string;
  subtitle: string;
  commits: CommitSummary[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  onHover: (hash: string) => void;
}) {
  if (commits.length === 0) return null;
  return (
    <div>
      <div className="sticky top-0 bg-muted/50 px-3 py-1">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      {commits.map((commit) => (
        <button
          type="button"
          key={commit.hash}
          data-row={commit.hash}
          className={cn(
            "block w-full border-b px-3 py-2 text-left",
            selectedHash === commit.hash
              ? "bg-accent text-accent-foreground"
              : "hover:bg-muted/60",
          )}
          onClick={() => onSelect(commit.hash)}
          onMouseEnter={() => onHover(commit.hash)}
        >
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <GitCommitIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate" title={commit.subject}>
              {commit.subject}
            </span>
          </p>
          <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
            {commit.author} • {formatRelativeTime(commit.date)}
          </p>
        </button>
      ))}
    </div>
  );
}
