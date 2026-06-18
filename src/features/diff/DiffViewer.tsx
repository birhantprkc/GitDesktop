import {
  createDiffMultiSelectManager,
  DiffModeEnum,
  DiffView,
} from "@git-diff-view/react";
import { InfoIcon } from "@phosphor-icons/react";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { SelectedLine } from "@/lib/git/api";
import {
  buildHunkPatch,
  type DiffHunk,
  type ParsedDiff,
  parseHunks,
} from "@/lib/git/hunks";
import { useApplyPartial, useApplyPatch, useFileDiff } from "@/lib/git/queries";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import type { SelectedFile } from "@/lib/stores/ui";
import { useUiStore } from "@/lib/stores/ui";
import { useEffectiveSyntax } from "@/lib/syntax/queries";
import { toastError } from "@/lib/toast";
import { useIsDark } from "@/lib/use-is-dark";
import { DiffPlaceholder } from "./DiffPlaceholder";
import { createDiffFile, DiffModeToggle, DiffSurface } from "./DiffSurface";
import { ImagePanes } from "./ImageDiff";

/** Working-tree diff for the file selected in the changes panel. */
export function DiffViewer({ repoPath }: { repoPath: string }) {
  const selectedFile = useUiStore((s) => s.selectedFile);
  // Render off a deferred selection so rapidly arrowing the changes list only
  // mounts + loads the file landed on (the row keeps WorkingTreeDiff keyed, so
  // it remounts per file). The list highlight still uses the live selection.
  const deferredFile = useDeferredValue(selectedFile);

  if (!deferredFile) {
    return <DiffPlaceholder message="Select a file to see its changes" />;
  }
  return (
    <WorkingTreeDiff
      key={`${deferredFile.staged}:${deferredFile.path}`}
      repoPath={repoPath}
      file={deferredFile}
    />
  );
}

/** A pending line-selection within one hunk (drag-selected in its diff). */
interface Selection {
  hunkKey: string;
  lines: SelectedLine[];
}

/** Stable empty array for unselected hunks so `memo` skips re-rendering them. */
const NO_LINES: SelectedLine[] = [];

/**
 * The working-tree variant of the diff pane: hunks render as individual cards
 * with whole-hunk stage/unstage/discard actions, plus drag-to-select for
 * staging an individual subset of lines. Untracked, binary, and truncated
 * diffs fall back to the plain whole-file surface.
 */
function WorkingTreeDiff({
  repoPath,
  file,
}: {
  repoPath: string;
  file: SelectedFile;
}) {
  const diff = useFileDiff(repoPath, file);
  const applyPatch = useApplyPatch(repoPath);
  const applyPartial = useApplyPartial(repoPath);
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const isDark = useIsDark();
  const viewMode = settings.data?.diffViewMode ?? "unified";
  const [discard, setDiscard] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const clearSelection = useCallback(() => setSelection(null), []);

  const parsed: ParsedDiff | null = useMemo(() => {
    const data = diff.data;
    if (!data || data.isBinary || data.isTruncated) return null;
    return parseHunks(data.text);
  }, [diff.data]);

  const onSelect = useCallback((hunkKey: string, lines: SelectedLine[]) => {
    setSelection((prev) =>
      lines.length > 0
        ? { hunkKey, lines }
        : prev?.hunkKey === hunkKey
          ? null
          : prev,
    );
  }, []);

  // A truncated parse could cut a hunk in half — never offer to apply one.
  const hunkMode =
    !file.untracked && parsed !== null && parsed.hunks.length > 0;
  if (!hunkMode) {
    return (
      <DiffSurface
        filePath={file.path}
        diff={diff}
        repoPath={repoPath}
        // staged view compares HEAD → index; unstaged compares HEAD → worktree
        imageRevs={
          file.staged ? { old: "HEAD", new: ":0" } : { old: "HEAD", new: null }
        }
      />
    );
  }

  const onError = (e: unknown) => toastError(e);
  const busy = applyPatch.isPending || applyPartial.isPending;

  function applyHunk(
    hunk: DiffHunk,
    opts: { cached: boolean; reverse: boolean },
  ) {
    if (!parsed) return;
    applyPatch.mutate(
      { patch: buildHunkPatch(parsed, hunk), ...opts },
      { onError, onSuccess: clearSelection },
    );
  }

  function applyLines(
    hunk: DiffHunk,
    lines: SelectedLine[],
    opts: { cached: boolean; reverse: boolean },
  ) {
    if (!parsed) return;
    applyPartial.mutate(
      { diffText: buildHunkPatch(parsed, hunk), selected: lines, ...opts },
      { onError, onSuccess: clearSelection },
    );
  }

  const hunkKeyOf = (hunk: DiffHunk) => hunk.header + hunk.text.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {file.path}
        </span>
        <span className="shrink-0">
          <DiffModeToggle />
        </span>
      </div>
      <div className="ph-no-capture min-h-0 flex-1 overflow-auto">
        {file.path.toLowerCase().endsWith(".svg") && (
          <div className="border-b">
            <ImagePanes
              repoPath={repoPath}
              filePath={file.path}
              revs={
                file.staged
                  ? { old: "HEAD", new: ":0" }
                  : { old: "HEAD", new: null }
              }
            />
          </div>
        )}
        {(settings.data?.showLineStageHint ?? true) && (
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <InfoIcon className="size-3.5 shrink-0" />
            <span className="flex-1 leading-snug">
              Drag across lines in a hunk to {file.staged ? "unstage" : "stage"}{" "}
              just those lines.
            </span>
            <button
              type="button"
              onClick={() =>
                settings.data &&
                saveSettings.mutate({
                  ...settings.data,
                  showLineStageHint: false,
                })
              }
              className="shrink-0 font-medium whitespace-nowrap underline underline-offset-2 hover:no-underline"
            >
              Don't show again
            </button>
          </div>
        )}
        {parsed.hunks.map((hunk) => {
          const key = hunkKeyOf(hunk);
          const sel =
            selection && selection.hunkKey === key ? selection.lines : null;
          const n = sel?.length ?? 0;
          return (
            <section key={key} className="border-b">
              {/* Whole-hunk actions stay available even with a line selection. */}
              <div className="flex items-center gap-2 bg-muted/40 px-3 py-1">
                <code
                  className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                  title={hunk.header}
                >
                  {hunk.header}
                </code>
                {busy && <Spinner className="size-3" />}
                {file.staged ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      applyHunk(hunk, { cached: true, reverse: true })
                    }
                  >
                    Unstage hunk
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        applyHunk(hunk, { cached: true, reverse: false })
                      }
                    >
                      Stage hunk
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() =>
                        setDiscard({
                          label: hunk.header,
                          run: () =>
                            applyHunk(hunk, { cached: false, reverse: true }),
                        })
                      }
                    >
                      Discard…
                    </Button>
                  </>
                )}
              </div>
              {sel && (
                <div className="flex items-center gap-2 border-b bg-primary/10 px-3 py-1 text-[11px]">
                  <span className="flex-1 font-medium">
                    {n} {n === 1 ? "line" : "lines"} selected
                  </span>
                  {file.staged ? (
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        applyLines(hunk, sel, { cached: true, reverse: true })
                      }
                    >
                      Unstage
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        size="xs"
                        disabled={busy}
                        onClick={() =>
                          applyLines(hunk, sel, {
                            cached: true,
                            reverse: false,
                          })
                        }
                      >
                        Stage
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() =>
                          setDiscard({
                            label: `${n} selected ${n === 1 ? "line" : "lines"}`,
                            run: () =>
                              applyLines(hunk, sel, {
                                cached: false,
                                reverse: true,
                              }),
                          })
                        }
                      >
                        Discard…
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={clearSelection}
                  >
                    Clear
                  </Button>
                </div>
              )}
              <SelectableHunk
                filePath={file.path}
                hunkText={buildHunkPatch(parsed, hunk)}
                hunkKey={key}
                viewMode={viewMode}
                isDark={isDark}
                onSelect={onSelect}
                selected={sel ?? NO_LINES}
              />
            </section>
          );
        })}
      </div>

      <Dialog
        open={discard !== null}
        onOpenChange={(open) => {
          if (!open) setDiscard(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>
              Reverts <span className="font-mono">{discard?.label}</span> in{" "}
              {file.path} to the last committed version. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscard(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                discard?.run();
                setDiscard(null);
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const SELECT_CLASS = "gd-line-selected";

/** The diff row for a line. Unified mode tags the number span with
 *  `data-line-{new,old}-num`; split mode uses a generic `data-line-num` inside a
 *  cell marked `data-side`. Try both so either view works. */
function rowForLine(container: HTMLElement, side: "old" | "new", line: number) {
  const unifiedAttr =
    side === "new" ? "data-line-new-num" : "data-line-old-num";
  const span =
    container.querySelector(`span[${unifiedAttr}="${line}"]`) ??
    container.querySelector(
      `td[data-side="${side}"] span[data-line-num="${line}"]`,
    );
  return span?.closest("tr") ?? null;
}

function clearPaint(container: HTMLElement) {
  container
    .querySelectorAll(`.${SELECT_CLASS}`)
    .forEach((el) => el.classList.remove(SELECT_CLASS));
}

/** Highlight exactly these changed lines. */
function paintLines(container: HTMLElement, lines: SelectedLine[]) {
  clearPaint(container);
  for (const { side, line } of lines) {
    rowForLine(container, side, line)?.classList.add(SELECT_CLASS);
  }
}

/** Highlight an in-progress drag range for live feedback (includes context). */
function paintRange(
  container: HTMLElement,
  range: {
    side: "old" | "new";
    startLineNumber: number;
    endLineNumber: number;
  } | null,
) {
  clearPaint(container);
  if (!range) return;
  const lo = Math.min(range.startLineNumber, range.endLineNumber);
  const hi = Math.max(range.startLineNumber, range.endLineNumber);
  for (let n = lo; n <= hi; n++) {
    rowForLine(container, range.side, n)?.classList.add(SELECT_CLASS);
  }
}

/**
 * Renders one hunk's diff and lets the user drag-select lines within it. The
 * library's selection manager handles the drag gesture; we paint the highlight
 * ourselves (its own class doesn't apply in this standalone setup) by toggling
 * `gd-line-selected` on the rows, driven by React state so it stays correct
 * across re-renders. Memoized so other hunks don't re-render on a selection.
 */
const SelectableHunk = memo(function SelectableHunk({
  filePath,
  hunkText,
  hunkKey,
  viewMode,
  isDark,
  onSelect,
  selected,
}: {
  filePath: string;
  hunkText: string;
  hunkKey: string;
  viewMode: string;
  isDark: boolean;
  onSelect: (hunkKey: string, lines: SelectedLine[]) => void;
  selected: SelectedLine[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hunkRepoPath = useUiStore((s) => s.repoPath);
  const { syntaxMap, customLanguages } = useEffectiveSyntax(hunkRepoPath);
  const diffFile = useMemo(
    () => createDiffFile(filePath, hunkText, { syntaxMap, customLanguages }),
    [filePath, hunkText, syntaxMap, customLanguages],
  );
  // Keep latest callback/selection without re-creating the manager each render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !diffFile) return;
    const manager = createDiffMultiSelectManager(container, diffFile, {
      isUnifiedMode: viewMode !== "split",
      onSelectionChange: (range) => paintRange(container, range),
      onSelectionComplete: (result) => {
        const lines = (result?.lines ?? [])
          .filter((l) => l.isAdd || l.isDelete)
          .map(
            (l): SelectedLine => ({
              side: l.isAdd ? "new" : "old",
              line: l.lineNumber,
            }),
          );
        onSelectRef.current(hunkKey, lines);
      },
    });
    paintLines(container, selectedRef.current); // re-assert after (re)mount
    return () => manager.destroy();
  }, [diffFile, viewMode, hunkKey]);

  // Paint the committed selection from state (incl. cleared → []).
  useEffect(() => {
    const container = containerRef.current;
    if (container) paintLines(container, selected);
  }, [selected]);

  if (!diffFile) return <DiffPlaceholder message="No changes to show" />;
  return (
    <div ref={containerRef}>
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
    </div>
  );
});
