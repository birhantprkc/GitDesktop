import { openUrl } from "@tauri-apps/plugin-opener";
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
import { usePublishRepo } from "@/lib/git/queries";
import { toastError } from "@/lib/toast";

export function PublishDialog({
  repoPath,
  defaultName,
  open,
  onOpenChange,
}: {
  repoPath: string;
  defaultName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const publish = usePublishRepo(repoPath);

  const form = useAppForm({
    defaultValues: { name: defaultName, description: "", isPrivate: true },
    onSubmit: async ({ value }) => {
      try {
        const url = await publish.mutateAsync({
          name: value.name.trim(),
          isPrivate: value.isPrivate,
          description: value.description,
        });
        toast.success(`Published ${value.name.trim()}`, {
          description: url,
          action: { label: "View", onClick: () => openUrl(url) },
        });
        onOpenChange(false);
      } catch (e) {
        toastError(e);
      }
    },
  });

  const seedOnOpen = useEffectEvent(() =>
    form.reset({ name: defaultName, description: "", isPrivate: true }),
  );
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Publish repository</DialogTitle>
            <DialogDescription>
              Creates a GitHub repository, adds it as{" "}
              <span className="font-mono">origin</span>, and pushes the current
              branch. Use <span className="font-mono">owner/name</span> to
              publish under an organization.
            </DialogDescription>
          </DialogHeader>
          <form.AppField
            name="name"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField label="Name" placeholder="my-project" />
            )}
          </form.AppField>
          <form.AppField name="description">
            {(field) => (
              <field.TextField
                label="Description (optional)"
                placeholder="What is this project?"
              />
            )}
          </form.AppField>
          <DialogFooter className="sm:items-center">
            <form.AppField name="isPrivate">
              {(field) => (
                <field.CheckboxField
                  label="Keep this code private"
                  className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
                />
              )}
            </form.AppField>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton>Publish</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
