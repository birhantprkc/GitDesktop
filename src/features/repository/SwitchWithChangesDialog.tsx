import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Prompt shown when switching branches with uncommitted changes: bring the
 * changes along, or stash them so the current branch stays put. Open when
 * `target` is the pending switch (null = closed). Presentational — the switcher
 * owns the checkout/stash mutations and hands down the actions + pending flags.
 */
export function SwitchWithChangesDialog({
  target,
  currentLabel,
  onCancel,
  onBringChanges,
  onStashAndSwitch,
  bringPending,
  stashPending,
}: {
  target: { name: string; remote: string | null } | null;
  currentLabel: string;
  onCancel: () => void;
  onBringChanges: () => void;
  onStashAndSwitch: () => void;
  bringPending: boolean;
  stashPending: boolean;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>You have changes in progress</DialogTitle>
          <DialogDescription>
            Bring your uncommitted changes along to {target?.name}, or stash
            them so {currentLabel} stays as you left it. "Pop latest stash"
            restores stashed changes later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={stashPending}
            onClick={onStashAndSwitch}
          >
            Stash and switch
          </Button>
          <Button disabled={bringPending} onClick={onBringChanges}>
            Bring changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
