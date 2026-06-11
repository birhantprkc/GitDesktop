import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
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
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed on open
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setDescription("");
    setIsPrivate(true);
  }, [open]);

  function submit() {
    publish.mutate(
      { name: name.trim(), isPrivate, description },
      {
        onSuccess: (url) => {
          toast.success(`Published ${name.trim()}`, {
            description: url,
            action: { label: "View", onClick: () => openUrl(url) },
          });
          onOpenChange(false);
        },
        onError: toastError,
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish repository</DialogTitle>
          <DialogDescription>
            Creates a GitHub repository, adds it as{" "}
            <span className="font-mono">origin</span>, and pushes the current
            branch. Use <span className="font-mono">owner/name</span> to publish
            under an organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="publish-name">Name</Label>
          <Input
            id="publish-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-project"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="publish-desc">Description (optional)</Label>
          <Input
            id="publish-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project?"
            autoComplete="off"
          />
        </div>

        <DialogFooter className="sm:items-center">
          <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Keep this code private
          </label>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || publish.isPending} onClick={submit}>
            {publish.isPending && <Spinner data-icon="inline-start" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
