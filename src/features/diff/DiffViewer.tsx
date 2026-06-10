import { DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import { useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useFileDiff } from "@/lib/git/queries";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
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

export function DiffViewer({ repoPath }: { repoPath: string }) {
  const selectedFile = useUiStore((s) => s.selectedFile);
  const diff = useFileDiff(repoPath, selectedFile);
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const isDark = useIsDark();

  const viewMode = settings.data?.diffViewMode ?? "unified";

  const diffFile = useMemo(() => {
    const text = diff.data?.text;
    if (!text || diff.data?.isBinary) return null;
    try {
      const file = DiffFile.createInstance({
        oldFile: { fileName: selectedFile?.path ?? "" },
        newFile: { fileName: selectedFile?.path ?? "" },
        hunks: [text],
      });
      file.initRaw();
      return file;
    } catch {
      return null;
    }
  }, [diff.data, selectedFile?.path]);

  if (!selectedFile) {
    return <DiffPlaceholder message="Select a file to see its changes" />;
  }
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
          {selectedFile.path}
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
