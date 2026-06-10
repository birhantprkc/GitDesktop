import { DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { FileDiff } from "@/lib/git/types";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import { DiffPlaceholder } from "./DiffPlaceholder";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function useIsDark() {
  return useSyncExternalStore(
    (notify) => {
      darkQuery.addEventListener("change", notify);
      return () => darkQuery.removeEventListener("change", notify);
    },
    () => darkQuery.matches,
  );
}

/**
 * Renders a single file diff (with loading/binary/empty placeholders and the
 * unified/split toggle) for any diff query — working tree or a commit.
 */
export function DiffSurface({
  filePath,
  diff,
}: {
  filePath: string;
  diff: UseQueryResult<FileDiff>;
}) {
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const isDark = useIsDark();
  const viewMode = settings.data?.diffViewMode ?? "unified";

  const diffFile = useMemo(() => {
    const text = diff.data?.text;
    if (!text || diff.data?.isBinary) return null;
    try {
      const file = DiffFile.createInstance({
        oldFile: { fileName: filePath },
        newFile: { fileName: filePath },
        hunks: [text],
      });
      file.initRaw();
      return file;
    } catch {
      return null;
    }
  }, [diff.data, filePath]);

  if (diff.isPending) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (diff.isError) {
    return <DiffPlaceholder message="Could not load diff for this file" />;
  }
  if (diff.data.isBinary) {
    return <DiffPlaceholder message="Binary file — no text diff available" />;
  }
  if (!diff.data.text.trim() || !diffFile) {
    return <DiffPlaceholder message="No changes to show" />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {filePath}
          {diff.data.isTruncated && " (truncated — diff too large)"}
        </span>
        <ButtonGroup>
          <Button
            variant={viewMode === "unified" ? "secondary" : "ghost"}
            size="xs"
            onClick={() =>
              settings.data &&
              saveSettings.mutate({ ...settings.data, diffViewMode: "unified" })
            }
          >
            Unified
          </Button>
          <Button
            variant={viewMode === "split" ? "secondary" : "ghost"}
            size="xs"
            onClick={() =>
              settings.data &&
              saveSettings.mutate({ ...settings.data, diffViewMode: "split" })
            }
          >
            Split
          </Button>
        </ButtonGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <DiffView
          diffFile={diffFile}
          diffViewMode={
            viewMode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified
          }
          diffViewTheme={isDark ? "dark" : "light"}
          diffViewHighlight={false}
          diffViewWrap
          diffViewFontSize={12}
        />
      </div>
    </div>
  );
}
