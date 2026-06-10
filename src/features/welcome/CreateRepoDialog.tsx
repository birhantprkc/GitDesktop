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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { createRepo, validateRepo } from "@/lib/git/api";
import { useAddRecentRepo, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

const NONE = "__none__";
const GITIGNORE_TEMPLATES = ["Node", "Python", "Rust", "Go"];
const LICENSES = ["MIT", "Unlicense"];

function selectItems(values: string[]): Record<string, string> {
  return { [NONE]: "None", ...Object.fromEntries(values.map((v) => [v, v])) };
}

export function CreateRepoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const openRepo = useUiStore((s) => s.openRepo);
  const addRecent = useAddRecentRepo();
  const settings = useSettings();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [initReadme, setInitReadme] = useState(true);
  const [gitignore, setGitignore] = useState(NONE);
  const [license, setLicense] = useState(NONE);
  const [creating, setCreating] = useState(false);

  async function pickParentDir() {
    const path = await openDialog({
      directory: true,
      title: "Create repository in folder",
    });
    if (path) setParentDir(path);
  }

  // tolerate cached settings predating this field (e.g. right after update)
  const defaultBranch =
    (settings.data?.defaultBranch ?? "main").trim() || "main";

  async function create() {
    setCreating(true);
    try {
      const root = await createRepo({
        name: name.trim(),
        description: description.trim(),
        parentDir,
        initReadme,
        gitignore: gitignore === NONE ? null : gitignore,
        license: license === NONE ? null : license,
        defaultBranch,
      });
      const info = await validateRepo(root);
      addRecent.mutate({ path: info.root, name: info.name });
      onOpenChange(false);
      setName("");
      setDescription("");
      openRepo(info);
      toast.success(`Created ${info.name}`);
    } catch (e) {
      toastError(e);
    } finally {
      setCreating(false);
    }
  }

  const canCreate = name.trim().length > 0 && parentDir.length > 0 && !creating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new repository</DialogTitle>
          <DialogDescription>
            Initializes a git repository on the "{defaultBranch}" branch (change
            in Settings).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repo-name">Name</Label>
            <Input
              id="repo-name"
              placeholder="repository name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-description">Description</Label>
            <Input
              id="repo-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={creating}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-path">Local path</Label>
            <div className="flex gap-2">
              <Input
                id="repo-path"
                placeholder="Choose a folder…"
                value={parentDir}
                readOnly
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={pickParentDir}
                disabled={creating}
              >
                Choose…
              </Button>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={initReadme}
              onChange={(e) => setInitReadme(e.target.checked)}
              disabled={creating}
            />
            Initialize this repository with a README
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Git ignore</Label>
              <Select
                items={selectItems(GITIGNORE_TEMPLATES)}
                value={gitignore}
                onValueChange={(v) => v && setGitignore(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {GITIGNORE_TEMPLATES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>License</Label>
              <Select
                items={selectItems(LICENSES)}
                value={license}
                onValueChange={(v) => v && setLicense(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {LICENSES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button onClick={create} disabled={!canCreate}>
            {creating && <Spinner data-icon="inline-start" />}
            Create repository
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
