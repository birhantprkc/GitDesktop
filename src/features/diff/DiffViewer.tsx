import { useMemo, useState } from "react";
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
import {
  buildHunkPatch,
  type DiffHunk,
  type ParsedDiff,
  parseHunks,
} from "@/lib/git/hunks";
import { useApplyPatch, useFileDiff } from "@/lib/git/queries";
import type { SelectedFile } from "@/lib/stores/ui";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { DiffPlaceholder } from "./DiffPlaceholder";
import { DiffModeToggle, DiffSurface, GitDiffView } from "./DiffSurface";
import { ImagePanes } from "./ImageDiff";

/** Working-tree diff for the file selected in the changes panel. */
export function DiffViewer({ repoPath }: { repoPath: string }) {
  const selectedFile = useUiStore((s) => s.selectedFile);

  if (!selectedFile) {
    return <DiffPlaceholder message="Select a file to see its changes" />;
  }
  return (
    <WorkingTreeDiff
      key={`${selectedFile.staged}:${selectedFile.path}`}
      repoPath={repoPath}
      file={selectedFile}
    />
  );
}

/**
 * The working-tree variant of the diff pane: hunks render as individual
 * cards with stage/unstage/discard actions, so partial commits don't
 * require the CLI. Untracked, binary, and truncated diffs fall back to the
 * plain whole-file surface.
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
  const [discardHunk, setDiscardHunk] = useState<DiffHunk | null>(null);

  const parsed: ParsedDiff | null = useMemo(() => {
    const data = diff.data;
    if (!data || data.isBinary || data.isTruncated) return null;
    return parseHunks(data.text);
  }, [diff.data]);

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

  function apply(hunk: DiffHunk, opts: { cached: boolean; reverse: boolean }) {
    if (!parsed) return;
    applyPatch.mutate(
      { patch: buildHunkPatch(parsed, hunk), ...opts },
      { onError },
    );
  }

  function confirmDiscard() {
    if (!discardHunk) return;
    apply(discardHunk, { cached: false, reverse: true });
    setDiscardHunk(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {file.path}
        </span>
        <DiffModeToggle />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
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
        {parsed.hunks.map((hunk) => (
          <section key={hunk.header + hunk.text.length} className="border-b">
            <div className="flex items-center gap-2 bg-muted/40 px-3 py-1">
              <code
                className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                title={hunk.header}
              >
                {hunk.header}
              </code>
              {applyPatch.isPending && <Spinner className="size-3" />}
              {file.staged ? (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={applyPatch.isPending}
                  onClick={() => apply(hunk, { cached: true, reverse: true })}
                >
                  Unstage hunk
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={applyPatch.isPending}
                    onClick={() =>
                      apply(hunk, { cached: true, reverse: false })
                    }
                  >
                    Stage hunk
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    disabled={applyPatch.isPending}
                    onClick={() => setDiscardHunk(hunk)}
                  >
                    Discard…
                  </Button>
                </>
              )}
            </div>
            <GitDiffView
              filePath={file.path}
              text={buildHunkPatch(parsed, hunk)}
            />
          </section>
        ))}
      </div>

      <Dialog
        open={discardHunk !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardHunk(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this hunk?</DialogTitle>
            <DialogDescription>
              Reverts <span className="font-mono">{discardHunk?.header}</span>{" "}
              in {file.path} to the last committed version. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardHunk(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={applyPatch.isPending}
              onClick={confirmDiscard}
            >
              Discard hunk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
