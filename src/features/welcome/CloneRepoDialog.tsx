import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";
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
import { cloneRepo, validateRepo } from "@/lib/git/api";
import { useAddRecentRepo } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

const DEFAULTS = { url: "", destination: "" };

export function CloneRepoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const openRepo = useUiStore((s) => s.openRepo);
  const addRecent = useAddRecentRepo();

  const form = useAppForm({
    defaultValues: DEFAULTS,
    onSubmit: async ({ value }) => {
      try {
        const clonedPath = await cloneRepo(
          value.url.trim(),
          value.destination.trim(),
        );
        const info = await validateRepo(clonedPath);
        addRecent.mutate({ path: info.root, name: info.name });
        onOpenChange(false);
        openRepo(info);
      } catch (e) {
        toastError(e);
      }
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed on open
  useEffect(() => {
    if (open) form.reset(DEFAULTS);
  }, [open]);

  async function pickDestination() {
    const path = await openDialog({
      directory: true,
      title: "Clone into folder",
    });
    if (path) form.setFieldValue("destination", path);
  }

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
            <DialogTitle>Clone repository</DialogTitle>
            <DialogDescription>
              Clones over HTTPS or SSH using your system git credentials.
            </DialogDescription>
          </DialogHeader>
          <form.AppField
            name="url"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField
                label="Repository URL"
                placeholder="https://github.com/user/repo.git"
              />
            )}
          </form.AppField>
          <form.AppField
            name="destination"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <div className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <field.TextField
                      label="Clone into"
                      placeholder="Type, paste, or choose a folder…"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={pickDestination}
                  >
                    Choose…
                  </Button>
                </div>
              </div>
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
              <form.SubmitButton>Clone</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
