import { TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { DiffContent } from "@/features/diff/DiffSurface";
import {
  useStashApply,
  useStashDrop,
  useStashList,
  useStashShow,
} from "@/lib/git/queries";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Browse the stash stack: preview what each stash would re-apply, then
 * apply, pop, or drop it.
 */
export function StashesDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const stashes = useStashList(repoPath, open);
  const apply = useStashApply(repoPath);
  const drop = useStashDrop(repoPath);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null);

  const list = stashes.data ?? [];
  // Default to the newest stash; fall back when the selected one is gone.
  const effectiveIndex =
    selectedIndex !== null && list.some((s) => s.index === selectedIndex)
      ? selectedIndex
      : (list[0]?.index ?? null);
  const preview = useStashShow(repoPath, open ? effectiveIndex : null);
  const busy = apply.isPending || drop.isPending;
  const onError = (e: unknown) => toastError(e);

  function applyStash(index: number, pop: boolean) {
    apply.mutate(
      { index, pop },
      {
        onSuccess: () =>
          toast.success(pop ? "Stash applied and dropped" : "Stash applied"),
        onError,
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Stashes</DialogTitle>
          <DialogDescription>
            Changes set aside with stash. Apply re-applies a stash to the
            working tree; pop also removes it from the stack.
          </DialogDescription>
        </DialogHeader>
        {list.length === 0 ? (
          <p className="flex-1 py-8 text-center text-xs text-muted-foreground">
            No stashes. "Stash all changes" in the branch menu sets the working
            tree aside here.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 border">
            <aside className="flex w-64 shrink-0 flex-col border-r">
              <ScrollArea className="min-h-0 flex-1">
                {list.map((stash) => (
                  <button
                    type="button"
                    key={stash.index}
                    className={cn(
                      "block w-full border-b px-3 py-2 text-left",
                      effectiveIndex === stash.index
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60",
                    )}
                    onClick={() => setSelectedIndex(stash.index)}
                  >
                    <p className="truncate text-xs font-medium">
                      {stash.message}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      stash@{"{"}
                      {stash.index}
                      {"}"} · {formatRelativeTime(stash.date)}
                    </p>
                  </button>
                ))}
              </ScrollArea>
              {effectiveIndex !== null && (
                <div className="flex items-center gap-1.5 border-t p-2">
                  {busy && <Spinner className="size-3" />}
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    aria-label="Drop stash"
                    disabled={busy}
                    onClick={() => setConfirmDrop(effectiveIndex)}
                  >
                    <TrashIcon data-icon="inline-start" />
                    Drop…
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() => applyStash(effectiveIndex, false)}
                  >
                    Apply
                  </Button>
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() => applyStash(effectiveIndex, true)}
                  >
                    Pop
                  </Button>
                </div>
              )}
            </aside>
            <main className="min-w-0 flex-1">
              {effectiveIndex !== null && (
                <DiffContent
                  filePath={`stash@{${effectiveIndex}}`}
                  data={preview.data}
                  isPending={preview.isPending}
                  isError={preview.isError}
                />
              )}
            </main>
          </div>
        )}

        <Dialog
          open={confirmDrop !== null}
          onOpenChange={(o) => {
            if (!o) setConfirmDrop(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Drop this stash?</DialogTitle>
              <DialogDescription>
                Permanently deletes stash@{"{"}
                {confirmDrop}
                {"}"} and the changes it holds. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDrop(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={drop.isPending}
                onClick={() => {
                  if (confirmDrop === null) return;
                  drop.mutate(confirmDrop, {
                    onSuccess: () => {
                      setConfirmDrop(null);
                      toast.success("Stash dropped");
                    },
                    onError: (e) => {
                      setConfirmDrop(null);
                      onError(e);
                    },
                  });
                }}
              >
                {drop.isPending && <Spinner data-icon="inline-start" />}
                Drop stash
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
