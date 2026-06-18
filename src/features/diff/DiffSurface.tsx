import { DiffFile, DiffModeEnum, DiffView } from "@git-diff-view/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import type { FileDiff } from "@/lib/git/types";
import type { CustomLanguage } from "@/lib/settings/api";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { useEffectiveSyntax } from "@/lib/syntax/queries";
import { useIsDark } from "@/lib/use-is-dark";
import { capDiffText, DIFF_LINE_CAP } from "./cap-diff";
import { DiffErrorBoundary } from "./DiffErrorBoundary";
import { DiffLanguagePicker } from "./DiffLanguagePicker";
import { DiffPlaceholder } from "./DiffPlaceholder";
import { diffLang } from "./diff-lang";
import { ImageDiff, ImagePanes, type ImageRevs, imageMime } from "./ImageDiff";
import { ensureCustomLanguages } from "./syntax";

/** User syntax preferences threaded into diff building. */
export interface SyntaxPrefs {
  syntaxMap?: Record<string, string>;
  customLanguages?: CustomLanguage[];
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
 * One rendered diff (a whole file or a single hunk) using the user's view
 * mode, theme, and syntax highlighting. Wrapped in a boundary because the
 * underlying renderer can throw while laying out certain diffs; the fallback
 * clears when `filePath`/`text` changes.
 */
export function GitDiffView({
  filePath,
  text,
}: {
  filePath: string;
  text: string;
}) {
  return (
    <DiffErrorBoundary resetKey={`${filePath} ${text.length}`}>
      <RenderedDiff filePath={filePath} text={text} />
    </DiffErrorBoundary>
  );
}

// Past this size, syntax highlighting (synchronous highlight.js) blocks long
// enough to hurt; render the still-diff-colored plain view instead.
const HIGHLIGHT_MAX_CHARS = 100_000;
// Mirror the renderer's own line threshold (maxLineToIgnoreSyntax, default
// 2000): above it the renderer refuses to highlight and logs a dev warning, so
// we skip initSyntax ourselves rather than ask for work it won't do. rawLength
// (the reconstructed file line count) is populated by initRaw but absent from
// the public type.
const HIGHLIGHT_MAX_LINES = 2000;

/**
 * Build a parsed `DiffFile` from unified-diff text, with syntax highlighting
 * when the file is small enough for the renderer to bother. Returns null for
 * empty/unparseable input. Exposed so callers that need the instance (e.g. the
 * line-selection manager) can build it directly.
 */
export function createDiffFile(
  filePath: string,
  text: string,
  prefs?: SyntaxPrefs,
): DiffFile | null {
  if (!text.trim()) return null;
  try {
    // Register any custom grammars referenced by the user's map before we look
    // up the language (idempotent; cheap when unchanged).
    if (prefs?.customLanguages?.length) {
      ensureCustomLanguages(prefs.customLanguages);
    }
    const lang = diffLang(filePath, prefs?.syntaxMap);
    const file = DiffFile.createInstance({
      oldFile: { fileName: filePath, fileLang: lang },
      newFile: { fileName: filePath, fileLang: lang },
      hunks: [text],
    });
    file.initRaw();
    // Highlighting is cheap (<10ms even here); the real cost is the DiffView
    // render, so build the diff in a single pass — skipping highlight for files
    // too big in chars or lines for the renderer to highlight anyway.
    const rawLines = (file as { rawLength?: number }).rawLength ?? 0;
    if (
      lang &&
      text.length <= HIGHLIGHT_MAX_CHARS &&
      rawLines <= HIGHLIGHT_MAX_LINES
    ) {
      file.initSyntax();
    }
    return file;
  } catch {
    return null;
  }
}

function RenderedDiff({ filePath, text }: { filePath: string; text: string }) {
  const settings = useSettings();
  const isDark = useIsDark();
  const viewMode = settings.data?.diffViewMode ?? "unified";

  // Large diffs are capped (the renderer isn't virtualized — see cap-diff.ts);
  // "Show full diff" opts into the whole thing. Reset when the file changes so
  // a previously-expanded file doesn't carry over to the next one.
  const [showFull, setShowFull] = useState(false);
  const [prevPath, setPrevPath] = useState(filePath);
  if (prevPath !== filePath) {
    setPrevPath(filePath);
    if (showFull) setShowFull(false);
  }

  // Build the diff off deferred values so rapid arrow-key navigation isn't
  // forced to rebuild on every keystroke: React keeps the previous diff on
  // screen and builds the new one at low priority, coalescing fast steps.
  const deferredText = useDeferredValue(text);
  const deferredPath = useDeferredValue(filePath);

  const { shown, hidden } = useMemo(() => {
    const r = showFull
      ? { text: deferredText, hidden: 0 }
      : capDiffText(deferredText, DIFF_LINE_CAP);
    return { shown: r.text, hidden: r.hidden };
  }, [deferredText, showFull]);

  const repoPath = useUiStore((s) => s.repoPath);
  const { syntaxMap, customLanguages } = useEffectiveSyntax(repoPath);
  const diffFile = useMemo(
    () => createDiffFile(deferredPath, shown, { syntaxMap, customLanguages }),
    [shown, deferredPath, syntaxMap, customLanguages],
  );

  if (!diffFile) return <DiffPlaceholder message="No changes to show" />;
  return (
    <>
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
      {hidden > 0 && (
        <div className="flex items-center justify-center gap-3 border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {hidden.toLocaleString()} more {hidden === 1 ? "line" : "lines"}{" "}
            hidden for performance
          </span>
          <Button size="xs" variant="outline" onClick={() => setShowFull(true)}>
            Show full diff
          </Button>
        </div>
      )}
    </>
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
  // Diffs load near-instantly from local git, so a skeleton only adds a flash
  // and a layout shift on the way to the real content — render nothing until
  // it's ready.
  if (isPending) return null;
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
    // ph-no-capture: blocks the whole pane (file path + diff body) from session
    // replay — this is user code/paths. See src/components/Redacted.tsx.
    <div className="ph-no-capture flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {filePath}
          {data.isTruncated && " (truncated — diff too large)"}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <DiffLanguagePicker filePath={filePath} />
          <DiffModeToggle />
        </span>
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
