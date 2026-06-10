import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cloneRepo, validateRepo } from "@/lib/git/api";
import { useAddRecentRepo } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { errorMessage } from "@/lib/tauri/invoke";

export function CloneRepoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const openRepo = useUiStore((s) => s.openRepo);
  const addRecent = useAddRecentRepo();
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState("");
  const [cloning, setCloning] = useState(false);

  async function pickDestination() {
    const path = await openDialog({
      directory: true,
      title: "Clone into folder",
    });
    if (path) setDestination(path);
  }

  async function clone() {
    setCloning(true);
    try {
      const clonedPath = await cloneRepo(url.trim(), destination);
      const info = await validateRepo(clonedPath);
      addRecent.mutate({ path: info.root, name: info.name });
      onOpenChange(false);
      setUrl("");
      openRepo(info);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCloning(false);
    }
  }

  const canClone = url.trim().length > 0 && destination.length > 0 && !cloning;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clone repository</DialogTitle>
          <DialogDescription>
            Clones over HTTPS or SSH using your system git credentials.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clone-url">Repository URL</Label>
            <Input
              id="clone-url"
              placeholder="https://github.com/user/repo.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={cloning}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clone-dest">Clone into</Label>
            <div className="flex gap-2">
              <Input
                id="clone-dest"
                placeholder="Choose a folder…"
                value={destination}
                readOnly
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={pickDestination}
                disabled={cloning}
              >
                Browse
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cloning}
          >
            Cancel
          </Button>
          <Button onClick={clone} disabled={!canClone}>
            {cloning && <Spinner data-icon="inline-start" />}
            {cloning ? "Cloning…" : "Clone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
