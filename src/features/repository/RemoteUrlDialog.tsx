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
import { useRemoteUrl, useSetRemoteUrl } from "@/lib/git/queries";
import { toastError } from "@/lib/toast";

/** Edits origin's URL — e.g. after a repo rename or an HTTPS↔SSH switch. */
export function RemoteUrlDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const currentUrl = useRemoteUrl(repoPath, "origin", open);
  const setUrl = useSetRemoteUrl(repoPath);

  const form = useAppForm({
    defaultValues: { url: "" },
    onSubmit: async ({ value }) => {
      try {
        await setUrl.mutateAsync({ name: "origin", url: value.url.trim() });
        toast.success("Remote URL updated");
        onOpenChange(false);
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Seed with the current URL once it arrives while open.
  // keepDefaultValues: otherwise the per-render options sync clobbers the
  // seeded value back to empty (untouched form).
  const seed = useEffectEvent((url: string) =>
    form.reset({ url }, { keepDefaultValues: true }),
  );
  useEffect(() => {
    if (open && currentUrl.data !== undefined) seed(currentUrl.data);
  }, [open, currentUrl.data]);

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
            <DialogTitle>Change remote URL</DialogTitle>
            <DialogDescription>
              Where <span className="font-mono">origin</span> points. Fetch,
              pull, push, and the GitHub integration all follow this URL.
            </DialogDescription>
          </DialogHeader>
          <form.AppField
            name="url"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField
                label="URL"
                placeholder="https://github.com/owner/repo.git"
              />
            )}
          </form.AppField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton>Save</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
