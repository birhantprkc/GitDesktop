import { GitPullRequestIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useGhStatus, usePrList } from "@/lib/git/queries";
import { useLocalPrs } from "@/lib/pulls/queries";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { CreateLocalPrDialog } from "./CreateLocalPrDialog";

export function PullRequestsPanel({ repoPath }: { repoPath: string }) {
  const gh = useGhStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const prList = usePrList(repoPath, ghReady);
  const localPrs = useLocalPrs(repoPath);
  const selectedPr = useUiStore((s) => s.selectedPr);
  const selectPr = useUiStore((s) => s.selectPr);
  const [createOpen, setCreateOpen] = useState(false);

  const openLocal = (localPrs.data ?? []).filter((p) => p.status === "open");
  const closedLocal = (localPrs.data ?? []).filter((p) => p.status !== "open");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <p className="text-xs text-muted-foreground">Local</p>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setCreateOpen(true)}
            title="Create a local pull request"
          >
            <PlusIcon data-icon="inline-start" />
            New
          </Button>
        </div>
        {openLocal.length === 0 && closedLocal.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No local pull requests.
          </p>
        ) : (
          [...openLocal, ...closedLocal].map((pr) => {
            const active =
              selectedPr?.kind === "local" && selectedPr.id === pr.id;
            return (
              <button
                type="button"
                key={pr.id}
                className={cn(
                  "block w-full border-b px-3 py-2 text-left",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/60",
                )}
                onClick={() => selectPr({ kind: "local", id: pr.id })}
              >
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <GitPullRequestIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{pr.title}</span>
                  {pr.status !== "open" && (
                    <Badge variant="secondary" className="capitalize">
                      {pr.status}
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
                  {pr.head} → {pr.base}
                </p>
              </button>
            );
          })
        )}

        <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground">GitHub</p>
        {!ghReady ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            Sign in with the GitHub CLI (gh auth login) to see pull requests.
          </p>
        ) : prList.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (prList.data?.length ?? 0) === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No open pull requests.
          </p>
        ) : (
          prList.data?.map((pr) => {
            const active =
              selectedPr?.kind === "remote" &&
              selectedPr.id === String(pr.number);
            return (
              <button
                type="button"
                key={pr.number}
                className={cn(
                  "block w-full border-b px-3 py-2 text-left",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/60",
                )}
                onClick={() =>
                  selectPr({ kind: "remote", id: String(pr.number) })
                }
              >
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <GitPullRequestIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{pr.title}</span>
                  {pr.isDraft && <Badge variant="secondary">draft</Badge>}
                </p>
                <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
                  #{pr.number} · {pr.headRefName} → {pr.baseRefName}
                </p>
              </button>
            );
          })
        )}
      </ScrollArea>

      <CreateLocalPrDialog
        repoPath={repoPath}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
