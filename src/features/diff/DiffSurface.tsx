import { DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { FileDiff } from "@/lib/git/types";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import { DiffPlaceholder } from "./DiffPlaceholder";
import { diffLang } from "./diff-lang";
import { ImageDiff, ImagePanes, type ImageRevs, imageMime } from "./ImageDiff";

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

/** The persisted Unified/Split preference toggle. */
export function DiffModeToggle() {
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const viewMode = settings.data?.diffViewMode ?? "unified";
  return (
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
  );
}

/**
 * One rendered unified diff (a whole file or a single hunk) using the
 * user's view mode, theme, and syntax highlighting.
 */
export function GitDiffView({
  filePath,
  text,
}: {
  filePath: string;
  text: string;
}) {
  const settings = useSettings();
  const isDark = useIsDark();
  const viewMode = settings.data?.diffViewMode ?? "unified";

  const diffFile = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const lang = diffLang(filePath);
      const file = DiffFile.createInstance({
        oldFile: { fileName: filePath, fileLang: lang },
        newFile: { fileName: filePath, fileLang: lang },
        hunks: [text],
      });
      file.initRaw();
      // Highlight only files whose language we recognize: with no language
      // the highlighter auto-detects by running every grammar it has.
      if (lang) file.initSyntax();
      return file;
    } catch {
      return null;
    }
  }, [text, filePath]);

  if (!diffFile) return <DiffPlaceholder message="No changes to show" />;
  return (
    <DiffView
      diffFile={diffFile}
      diffViewMode={
        viewMode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified
      }
      diffViewTheme={isDark ? "dark" : "light"}
      diffViewHighlight
      diffViewWrap
      diffViewFontSize={12}
    />
  );
}

/**
 * Renders a single file diff (with loading/binary/empty placeholders and the
 * unified/split toggle) for any diff query — working tree or a commit.
 */
export function DiffSurface({
  filePath,
  diff,
  repoPath,
  imageRevs,
}: {
  filePath: string;
  diff: UseQueryResult<FileDiff>;
  repoPath?: string;
  imageRevs?: ImageRevs;
}) {
  return (
    <DiffContent
      filePath={filePath}
      data={diff.data}
      isPending={diff.isPending}
      isError={diff.isError}
      repoPath={repoPath}
      imageRevs={imageRevs}
    />
  );
}

/**
 * The diff renderer itself, decoupled from TanStack Query so callers with an
 * already-resolved FileDiff (e.g. a PR's split unified diff) can reuse it.
 */
export function DiffContent({
  filePath,
  data,
  isPending,
  isError,
  repoPath,
  imageRevs,
}: {
  filePath: string;
  data: FileDiff | undefined;
  isPending: boolean;
  isError: boolean;
  /** With `imageRevs`, binary image files render as an image comparison. */
  repoPath?: string;
  imageRevs?: ImageRevs;
}) {
  if (isPending) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (isError || !data) {
    return <DiffPlaceholder message="Could not load diff for this file" />;
  }
  if (data.isBinary) {
    if (repoPath && imageRevs && imageMime(filePath)) {
      return (
        <ImageDiff repoPath={repoPath} filePath={filePath} revs={imageRevs} />
      );
    }
    return <DiffPlaceholder message="Binary file — no text diff available" />;
  }
  if (!data.text.trim()) {
    return <DiffPlaceholder message="No changes to show" />;
  }

  // SVGs are text, but they're also images: show the rendered old/new
  // comparison above the code diff when revisions are available.
  const svgPreview = Boolean(
    repoPath && imageRevs && filePath.toLowerCase().endsWith(".svg"),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {filePath}
          {data.isTruncated && " (truncated — diff too large)"}
        </span>
        <DiffModeToggle />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {svgPreview && repoPath && imageRevs && (
          <div className="border-b">
            <ImagePanes
              repoPath={repoPath}
              filePath={filePath}
              revs={imageRevs}
            />
          </div>
        )}
        <GitDiffView filePath={filePath} text={data.text} />
      </div>
    </div>
  );
}
