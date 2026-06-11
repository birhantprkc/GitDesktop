import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffContent } from "@/features/diff/DiffSurface";
import { splitUnifiedDiff } from "@/lib/git/diff-split";
import { usePrDetails, usePrDiff } from "@/lib/git/queries";
import type { PrThreadOut } from "@/lib/git/types";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type Section = "conversation" | "commits" | "files";

function checkTone(status: string): string {
  const s = status.toUpperCase();
  if (s === "SUCCESS") return "text-green-600 dark:text-green-400";
  if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(s))
    return "text-red-600 dark:text-red-400";
  return "text-amber-600 dark:text-amber-400";
}

export function RemotePrView({
  repoPath,
  number,
}: {
  repoPath: string;
  number: number;
}) {
  const details = usePrDetails(repoPath, number);
  const prDiff = usePrDiff(repoPath, number);
  const [section, setSection] = useState<Section>("conversation");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const pr = details.data;
  const fileSections = useMemo(
    () => splitUnifiedDiff(prDiff.data ?? ""),
    [prDiff.data],
  );

  useEffect(() => {
    setSelectedPath(pr?.files[0]?.path ?? null);
  }, [pr?.files]);

  if (details.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (details.isError || !pr) {
    return <DiffPlaceholder message="Could not load this pull request" />;
  }

  const fileDiff = selectedPath
    ? {
        filePath: selectedPath,
        text: fileSections.get(selectedPath) ?? "",
        isBinary: (fileSections.get(selectedPath) ?? "").includes(
          "Binary files ",
        ),
        isTruncated: false,
      }
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="text-sm font-medium">
            {pr.title}{" "}
            <span className="font-normal text-muted-foreground">
              #{pr.number}
            </span>
          </h2>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="xs"
            onClick={() => openUrl(pr.url)}
            title="Open this pull request on GitHub"
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            GitHub
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={pr.state === "OPEN" ? "default" : "secondary"}>
            {pr.isDraft ? "Draft" : pr.state.toLowerCase()}
          </Badge>
          <span>{pr.author}</span>
          <span>•</span>
          <span className="font-mono">{pr.headRefName}</span>
          <span>→</span>
          <span className="font-mono">{pr.baseRefName}</span>
          <span className="text-green-600 dark:text-green-400">
            +{pr.additions}
          </span>
          <span className="text-red-600 dark:text-red-400">
            -{pr.deletions}
          </span>
        </div>
        {pr.checks.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {pr.checks.map((c) => (
              <span
                key={c.name}
                className={cn("truncate", checkTone(c.status))}
              >
                {c.name}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-1 pt-1">
          {(["conversation", "commits", "files"] as const).map((s) => (
            <Button
              key={s}
              variant={section === s ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setSection(s)}
            >
              {s === "conversation"
                ? "Conversation"
                : s === "commits"
                  ? `Commits (${pr.commits.length})`
                  : `Files (${pr.files.length})`}
            </Button>
          ))}
        </div>
      </header>

      {section === "conversation" && (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            <div className="border-b pb-3">
              {pr.body.trim() ? (
                <Markdown>{pr.body}</Markdown>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No description provided.
                </p>
              )}
            </div>
            {pr.reviews.map((r, i) => (
              <Thread key={`r${i}-${r.author}`} thread={r} />
            ))}
            {pr.comments.map((c, i) => (
              <Thread key={`c${i}-${c.author}`} thread={c} />
            ))}
            {pr.reviews.length === 0 && pr.comments.length === 0 && (
              <p className="text-xs text-muted-foreground">No activity yet.</p>
            )}
          </div>
        </ScrollArea>
      )}

      {section === "commits" && (
        <ScrollArea className="min-h-0 flex-1">
          {pr.commits.map((c) => (
            <div key={c.oid} className="border-b px-4 py-2">
              <p className="truncate text-xs font-medium">{c.headline}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{c.oid.slice(0, 7)}</span> •{" "}
                {c.author} • {c.date && formatRelativeTime(c.date)}
              </p>
            </div>
          ))}
        </ScrollArea>
      )}

      {section === "files" && (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r">
            <ScrollArea className="min-h-0 flex-1">
              {pr.files.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                    selectedPath === file.path
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/60",
                  )}
                  onClick={() => setSelectedPath(file.path)}
                  title={file.path}
                >
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {file.path}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="text-green-600 dark:text-green-400">
                      +{file.additions}
                    </span>{" "}
                    <span className="text-red-600 dark:text-red-400">
                      -{file.deletions}
                    </span>
                  </span>
                </button>
              ))}
            </ScrollArea>
          </aside>
          <main className="min-w-0 flex-1">
            {selectedPath ? (
              <DiffContent
                filePath={selectedPath}
                data={fileDiff}
                isPending={prDiff.isPending}
                isError={prDiff.isError}
              />
            ) : (
              <DiffPlaceholder message="Select a file to see its changes" />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function Thread({ thread }: { thread: PrThreadOut }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 text-xs">
        <span className="font-medium">{thread.author || "unknown"}</span>
        {thread.state && (
          <Badge variant="secondary">{thread.state.toLowerCase()}</Badge>
        )}
        <span className="text-muted-foreground">
          {thread.date && formatRelativeTime(thread.date)}
        </span>
      </p>
      {thread.body.trim() && <Markdown>{thread.body}</Markdown>}
    </div>
  );
}
