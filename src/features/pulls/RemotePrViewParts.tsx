import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { DiffContent } from "@/features/diff/DiffSurface";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { cn } from "@/lib/utils";

type PrFile = { path: string; additions: number; deletions: number };

/** The "Files" sub-tab: a file list down the left, the selected file's diff on
 *  the right. Presentational — the parent owns the selection + diff query. */
export function PrFilesPane({
  files,
  effectivePath,
  onSelectPath,
  fileDiff,
  isPending,
  isError,
}: {
  files: PrFile[];
  effectivePath: string | null;
  onSelectPath: (path: string) => void;
  fileDiff: ComponentProps<typeof DiffContent>["data"];
  isPending: boolean;
  isError: boolean;
}) {
  // Arrow keys walk the file list, mirroring the app's other diff lists.
  const onFilesKeyDown = listKeyboardNav({
    items: files,
    activeIndex: files.findIndex((f) => f.path === effectivePath),
    onActivate: (file) => onSelectPath(file.path),
    rowKey: (file) => file.path,
    rowAttr: "data-path",
  });

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r">
        <ScrollArea className="min-h-0 flex-1">
          <div onKeyDown={onFilesKeyDown}>
            {files.map((file) => (
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
                onClick={() => onSelectPath(file.path)}
                title={file.path}
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  {file.path}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="text-success">+{file.additions}</span>{" "}
                  <span className="text-destructive">-{file.deletions}</span>
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>
      <main className="min-w-0 flex-1">
        {effectivePath ? (
          <DiffContent
            filePath={effectivePath}
            data={fileDiff}
            isPending={isPending}
            isError={isError}
          />
        ) : (
          <DiffPlaceholder message="Select a file to see its changes" />
        )}
      </main>
    </div>
  );
}

/** Merge-confirm dialog. Presentational — the parent keeps the merge mutation
 *  (so its `busy` flag stays accurate) and passes `pending` + `onConfirm`. */
export function MergePrDialog({
  open,
  onClose,
  number,
  headRefName,
  baseRefName,
  strategyLabel,
  deleteBranch,
  onDeleteBranchChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  number: number;
  headRefName: string;
  baseRefName: string;
  strategyLabel: string;
  deleteBranch: boolean;
  onDeleteBranchChange: (v: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge pull request #{number}?</DialogTitle>
          <DialogDescription>
            {strategyLabel} — merges{" "}
            <span className="font-mono">{headRefName}</span> into{" "}
            <span className="font-mono">{baseRefName}</span> on GitHub. This
            cannot be easily undone.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={deleteBranch}
            onCheckedChange={(checked) =>
              onDeleteBranchChange(checked === true)
            }
          />
          Delete <span className="font-mono">{headRefName}</span> after merging
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {pending && <Spinner data-icon="inline-start" />}
            {strategyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
