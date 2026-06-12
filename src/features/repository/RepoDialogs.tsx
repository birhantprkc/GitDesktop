import { useState } from "react";
import { toast } from "sonner";
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
import { Spinner } from "@/components/ui/spinner";
import { useAppForm } from "@/lib/form";
import { deleteRepoFolder } from "@/lib/git/api";
import { type RecentRepo, repoDisplayName } from "@/lib/settings/api";
import { useRemoveRecentRepo, useSetRepoAlias } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

/**
 * Create/change a repo's display alias. Mount with a `key` derived from the
 * target repo so the form reseeds per repo.
 */
export function RepoAliasDialog({
  repo,
  onClose,
}: {
  repo: RecentRepo | null;
  onClose: () => void;
}) {
  const setAlias = useSetRepoAlias();

  const form = useAppForm({
    defaultValues: { alias: repo?.alias ?? "" },
    onSubmit: async ({ value }) => {
      if (!repo) return;
      try {
        await setAlias.mutateAsync({ path: repo.path, alias: value.alias });
        toast.success(
          value.alias.trim()
            ? `${repo.name} is now shown as ${value.alias.trim()}`
            : "Alias removed",
        );
        onClose();
      } catch (e) {
        toastError(e);
      }
    },
  });

  return (
    <Dialog
      open={repo !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {repo?.alias ? "Change alias" : "Create alias"}
            </DialogTitle>
            <DialogDescription>
              A display name for <span className="font-mono">{repo?.name}</span>{" "}
              inside GitDesktop. It doesn't rename the folder or the repository.
              Leave empty to remove the alias.
            </DialogDescription>
          </DialogHeader>
          <form.AppField name="alias">
            {(field) => (
              <field.TextField label="Alias" placeholder={repo?.name ?? ""} />
            )}
          </form.AppField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
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

/**
 * Remove a repo from GitDesktop, optionally moving the folder to the OS
 * recycle bin. Closes the repo first when it's the one currently open.
 */
export function RemoveRepoDialog({
  repo,
  onClose,
}: {
  repo: RecentRepo | null;
  onClose: () => void;
}) {
  const removeRecent = useRemoveRecentRepo();
  const repoPath = useUiStore((s) => s.repoPath);
  const closeRepo = useUiStore((s) => s.closeRepo);
  const [moveToTrash, setMoveToTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const display = repo ? repoDisplayName(repo) : "";

  async function confirm() {
    if (!repo) return;
    setBusy(true);
    try {
      // Trash first: if that fails, the repo stays open and listed.
      if (moveToTrash) await deleteRepoFolder(repo.path);
      if (repo.path === repoPath) closeRepo();
      await removeRecent.mutateAsync(repo.path);
      toast.success(
        moveToTrash
          ? `${display} moved to the Recycle Bin`
          : `${display} removed from GitDesktop`,
      );
      setMoveToTrash(false);
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={repo !== null}
      onOpenChange={(o) => {
        if (!o) {
          setMoveToTrash(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {display}?</DialogTitle>
          <DialogDescription>
            Removes the repository from GitDesktop. The folder at{" "}
            <span className="font-mono">{repo?.path}</span> is kept unless you
            also move it to the Recycle Bin.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox
            checked={moveToTrash}
            onCheckedChange={(v) => setMoveToTrash(v === true)}
          />
          Also move this repository to the Recycle Bin
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={confirm}>
            {busy && <Spinner data-icon="inline-start" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
