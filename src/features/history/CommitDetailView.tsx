import { CopyIcon, DotsThreeVerticalIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AmendForcePushDialog } from "@/features/commit/AmendForcePushDialog";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffSurface } from "@/features/diff/DiffSurface";
import { copyText } from "@/lib/clipboard";
import {
  useCheckoutCommit,
  useCherryPick,
  useCommitDetails,
  useCommitFileDiff,
  useCommitFiles,
  useLog,
  useRevertCommit,
} from "@/lib/git/queries";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAmendWithConfirm } from "./useAmendCommit";

export function CommitDetailView({
  repoPath,
  hash,
}: {
  repoPath: string;
  hash: string;
}) {
  const details = useCommitDetails(repoPath, hash);
  const files = useCommitFiles(repoPath, hash);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Reset the manual selection when a different commit is shown — a render
  // -time state adjustment, not an effect.
  const [lastHash, setLastHash] = useState(hash);
  if (hash !== lastHash) {
    setLastHash(hash);
    setSelectedPath(null);
  }
  // Default to the first changed file until the user picks one (derived, so
  // there's no empty-selection frame while an effect catches up).
  const effectivePath =
    selectedPath && files.data?.some((f) => f.path === selectedPath)
      ? selectedPath
      : (files.data?.[0]?.path ?? null);
  const diff = useCommitFileDiff(repoPath, hash, effectivePath);

  // Same actions as the history list's right-click menu (minus the
  // dialog-driven ones), surfaced behind a visible ⋯ for discoverability.
  const log = useLog(repoPath);
  const { requestAmend, forcePushDialog } = useAmendWithConfirm(repoPath);
  const checkoutCommit = useCheckoutCommit(repoPath);
  const revertCommit = useRevertCommit(repoPath);
  const cherryPick = useCherryPick(repoPath);
  const isLatest = log.data?.pages[0]?.[0]?.hash === hash;
  const onError = (e: unknown) => toastError(e);

  if (details.isPending || files.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (details.isError || files.isError) {
    return <DiffPlaceholder message="Could not load this commit" />;
  }

  const commit = details.data;
  const totalAdded = files.data.reduce((sum, f) => sum + f.added, 0);
  const totalDeleted = files.data.reduce((sum, f) => sum + f.deleted, 0);

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(commit.hash);
      toast.success("Commit hash copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  // Arrow keys walk the file list, mirroring the app's other lists.
  function onFilesKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const fileList = files.data;
    if (!fileList || fileList.length === 0) return;
    e.preventDefault();
    const idx = fileList.findIndex((f) => f.path === effectivePath);
    const next =
      e.key === "ArrowDown"
        ? Math.min(idx + 1, fileList.length - 1)
        : Math.max(idx - 1, 0);
    const path = fileList[Math.max(next, 0)].path;
    setSelectedPath(path);
    const el = e.currentTarget.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(path)}"]`,
    );
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-1 border-b px-4 py-3">
        <h2 className="text-sm font-medium">{commit.subject}</h2>
        {commit.body && (
          <p className="max-h-24 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground">
            {commit.body}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[9px] uppercase">
            {commit.author.slice(0, 1)}
          </span>
          <span>{commit.author}</span>
          <span>•</span>
          <span>{formatRelativeTime(commit.date)}</span>
          <span>•</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-mono hover:text-foreground"
            onClick={copyHash}
            title="Copy full hash"
          >
            {commit.hash.slice(0, 7)}
            <CopyIcon className="size-3" />
          </button>
          <span className="flex-1" />
          <span className="text-green-600 dark:text-green-400">
            +{totalAdded}
          </span>
          <span className="text-red-600 dark:text-red-400">
            -{totalDeleted}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Commit actions"
                />
              }
            >
              <DotsThreeVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-56" align="end">
              <DropdownMenuItem
                disabled={!isLatest}
                onClick={() => requestAmend(hash)}
              >
                Amend commit…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => checkoutCommit.mutate(hash, { onError })}
              >
                Checkout commit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => revertCommit.mutate(hash, { onError })}
              >
                Revert changes in commit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  cherryPick.mutate(hash, {
                    onSuccess: (applied) => {
                      if (applied) {
                        toast.success(`Cherry-picked ${hash.slice(0, 7)}`);
                      } else {
                        toast.info(
                          "Nothing to cherry-pick — these changes are already on this branch.",
                        );
                      }
                    },
                    onError,
                  })
                }
              >
                Cherry-pick commit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => copyText(commit.hash, "SHA copied")}
              >
                Copy SHA
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r">
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
            {files.data.length} changed file{files.data.length === 1 ? "" : "s"}
          </p>
          <ScrollArea className="min-h-0 flex-1">
            <div onKeyDown={onFilesKeyDown}>
              {files.data.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  data-path={file.path}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                    effectivePath === file.path
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/60",
                  )}
                  onClick={() => setSelectedPath(file.path)}
                  title={file.path}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {file.path}
                  </span>
                  {file.isBinary ? (
                    <span className="shrink-0 text-muted-foreground">bin</span>
                  ) : (
                    <span className="shrink-0 tabular-nums">
                      <span className="text-green-600 dark:text-green-400">
                        +{file.added}
                      </span>{" "}
                      <span className="text-red-600 dark:text-red-400">
                        -{file.deleted}
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>
        <main className="min-w-0 flex-1">
          {effectivePath ? (
            <DiffSurface
              filePath={effectivePath}
              diff={diff}
              repoPath={repoPath}
              imageRevs={{ old: `${hash}~1`, new: hash }}
            />
          ) : (
            <DiffPlaceholder message="Select a file to see its changes" />
          )}
        </main>
      </div>

      <AmendForcePushDialog {...forcePushDialog} />
    </div>
  );
}
