import { useEffect, useEffectEvent } from "react";
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
import { required, useAppForm } from "@/lib/form";
import { useRenameBranch } from "@/lib/git/queries";
import { refNameWarning, sanitizeRefName } from "@/lib/git/ref-name";
import { toastError } from "@/lib/toast";

/**
 * Rename-branch dialog. Open when `target` is the branch being renamed (null =
 * closed). Owns its own form + the rename mutation; seeds the field with the
 * current name on open so the user edits from there.
 */
export function RenameBranchDialog({
  repoPath,
  target,
  onClose,
}: {
  repoPath: string;
  target: string | null;
  onClose: () => void;
}) {
  const renameBranch = useRenameBranch(repoPath);

  const renameForm = useAppForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      if (!target) return;
      const newName = sanitizeRefName(value.name);
      try {
        await renameBranch.mutateAsync({ oldName: target, newName });
        toast.success(`Renamed to ${newName}`);
        onClose();
      } catch (e) {
        toastError(e);
      }
    },
  });

  // NOTE: seeding resets must pass keepDefaultValues — otherwise reset()
  // rewrites the form's defaultValues, and react-form's per-render options
  // sync sees "different defaults + untouched form" and clobbers the seeded
  // values right back on the next render.
  const seedOnOpen = useEffectEvent((name: string) => {
    renameForm.reset({ name }, { keepDefaultValues: true });
  });
  useEffect(() => {
    if (target !== null) seedOnOpen(target);
  }, [target]);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            renameForm.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename branch</DialogTitle>
            <DialogDescription>Renames {target}.</DialogDescription>
          </DialogHeader>
          <renameForm.AppField
            name="name"
            validators={{
              onChange: ({ value }) =>
                required(value) ??
                (sanitizeRefName(value) === target ? "Unchanged" : undefined),
            }}
          >
            {(field) => (
              <field.TextField label="New name" warning={refNameWarning} />
            )}
          </renameForm.AppField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <renameForm.AppForm>
              <renameForm.SubmitButton>Rename</renameForm.SubmitButton>
            </renameForm.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
