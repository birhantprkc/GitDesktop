import { useState } from "react";
import { toast } from "sonner";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { copyText } from "@/lib/clipboard";
import { gitCommitDetails } from "@/lib/git/api";
import {
  useCheckoutCommit,
  useCherryPick,
  useCreateBranch,
  useCreateTag,
  useLog,
  useResetToCommit,
  useRevertCommit,
} from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { errorMessage } from "@/lib/tauri/invoke";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export function HistoryPanel({ repoPath }: { repoPath: string }) {
  const log = useLog(repoPath);
  const selectedCommitHash = useUiStore((s) => s.selectedCommitHash);
  const selectCommit = useUiStore((s) => s.selectCommit);
  const setCommitDraft = useUiStore((s) => s.setCommitDraft);
  const setAmending = useUiStore((s) => s.setAmending);
  const setRepoTab = useUiStore((s) => s.setRepoTab);

  const resetMutation = useResetToCommit(repoPath);
  const checkoutCommit = useCheckoutCommit(repoPath);
  const revertCommit = useRevertCommit(repoPath);
  const cherryPick = useCherryPick(repoPath);
  const createBranch = useCreateBranch(repoPath);
  const createTag = useCreateTag(repoPath);

  const [resetHash, setResetHash] = useState<string | null>(null);
  const [branchHash, setBranchHash] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [tagHash, setTagHash] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");

  const onError = (e: unknown) => toast.error(errorMessage(e));

  async function startAmend(hash: string) {
    try {
      const details = await gitCommitDetails(repoPath, hash);
      setCommitDraft(details.subject, details.body);
      setAmending(hash);
      setRepoTab("changes");
    } catch (e) {
      onError(e);
    }
  }

  if (log.isPending) {
    return (
      <div className="flex-1 space-y-3 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const commits = log.data ?? [];
  if (commits.length === 0) {
    return (
      <p className="flex-1 px-2 py-8 text-center text-xs text-muted-foreground">
        No commits yet
      </p>
    );
  }

  return (
    <>
      <ScrollArea className="min-h-0 flex-1">
        <div>
          {commits.map((commit, index) => (
            <ContextMenu key={commit.hash}>
              <ContextMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "block w-full border-b px-3 py-2 text-left",
                      selectedCommitHash === commit.hash
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60",
                    )}
                    onClick={() => selectCommit(commit.hash)}
                  >
                    <p className="truncate text-xs font-medium">
                      {commit.subject}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="flex size-3.5 items-center justify-center rounded-full bg-muted text-[8px] uppercase">
                        {commit.author.slice(0, 1)}
                      </span>
                      <span className="truncate">{commit.author}</span>
                      <span>•</span>
                      <span className="shrink-0">
                        {formatRelativeTime(commit.date)}
                      </span>
                    </p>
                  </button>
                }
              />
              <ContextMenuContent className="min-w-60">
                <ContextMenuItem
                  disabled={index !== 0}
                  onClick={() => startAmend(commit.hash)}
                >
                  Amend commit…
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={index === 0}
                  onClick={() => setResetHash(commit.hash)}
                >
                  Reset to commit…
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    checkoutCommit.mutate(commit.hash, { onError })
                  }
                >
                  Checkout commit
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => revertCommit.mutate(commit.hash, { onError })}
                >
                  Revert changes in commit
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => {
                    setBranchName("");
                    setBranchHash(commit.hash);
                  }}
                >
                  Create branch from commit…
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    setTagName("");
                    setTagHash(commit.hash);
                  }}
                >
                  Create tag…
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => cherryPick.mutate(commit.hash, { onError })}
                >
                  Cherry-pick commit
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => copyText(commit.hash, "SHA copied")}
                >
                  Copy SHA
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {commits.length >= 200 && (
            <p className="px-3 py-2 text-center text-[11px] text-muted-foreground">
              Showing the latest 200 commits
            </p>
          )}
        </div>
      </ScrollArea>

      <Dialog
        open={resetHash !== null}
        onOpenChange={(open) => {
          if (!open) setResetHash(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to commit?</DialogTitle>
            <DialogDescription>
              Moves the current branch to {resetHash?.slice(0, 7)}. Changes from
              later commits stay in your working tree as uncommitted changes
              (mixed reset). Commits that were only on this branch will be
              orphaned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetHash(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={resetMutation.isPending}
              onClick={() => {
                if (!resetHash) return;
                resetMutation.mutate(resetHash, {
                  onSuccess: () => {
                    toast.success(`Reset to ${resetHash.slice(0, 7)}`);
                    setResetHash(null);
                  },
                  onError: (e) => {
                    onError(e);
                    setResetHash(null);
                  },
                });
              }}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={branchHash !== null}
        onOpenChange={(open) => {
          if (!open) setBranchHash(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create branch from commit</DialogTitle>
            <DialogDescription>
              Creates a branch starting at {branchHash?.slice(0, 7)} and
              switches to it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="commit-branch-name">Branch name</Label>
            <Input
              id="commit-branch-name"
              placeholder="feature/from-commit"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchHash(null)}>
              Cancel
            </Button>
            <Button
              disabled={!branchName.trim() || createBranch.isPending}
              onClick={() => {
                if (!branchHash) return;
                createBranch.mutate(
                  {
                    name: branchName.trim(),
                    checkout: true,
                    startPoint: branchHash,
                  },
                  {
                    onSuccess: () => {
                      toast.success(`Created branch ${branchName.trim()}`);
                      setBranchHash(null);
                    },
                    onError,
                  },
                );
              }}
            >
              Create branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tagHash !== null}
        onOpenChange={(open) => {
          if (!open) setTagHash(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create tag</DialogTitle>
            <DialogDescription>
              Tags commit {tagHash?.slice(0, 7)}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tag-name">Tag name</Label>
            <Input
              id="tag-name"
              placeholder="v1.0.0"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagHash(null)}>
              Cancel
            </Button>
            <Button
              disabled={!tagName.trim() || createTag.isPending}
              onClick={() => {
                if (!tagHash) return;
                createTag.mutate(
                  { name: tagName.trim(), hash: tagHash },
                  {
                    onSuccess: () => {
                      toast.success(`Created tag ${tagName.trim()}`);
                      setTagHash(null);
                    },
                    onError,
                  },
                );
              }}
            >
              Create tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
