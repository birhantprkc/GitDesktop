import { type ReactNode, useEffect, useState } from "react";
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
import {
  useDeleteRepo,
  useRenameRepo,
  useRepoSettings,
  useSetArchived,
  useSetVisibility,
  useTransferRepo,
} from "@/lib/git/queries";
import type { RepoSettings } from "@/lib/git/types";
import { toastError } from "@/lib/toast";
import { ScopeRefreshHint } from "./ScopeRefreshHint";

/** A guarded destructive dialog: the confirm button stays disabled until the
 *  user types the repo's `owner/repo` exactly. */
function DangerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel,
  pending,
  disabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmPhrase: string;
  confirmLabel: string;
  pending: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const matches = typed.trim() === confirmPhrase;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <div className="space-y-1.5">
          <Label htmlFor="danger-confirm" className="text-xs">
            Type <span className="font-mono">{confirmPhrase}</span> to confirm
          </Label>
          <Input
            id="danger-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || disabled || pending}
            onClick={onConfirm}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function RenameAction({
  repoPath,
  repo,
}: {
  repoPath: string;
  repo: RepoSettings;
}) {
  const rename = useRenameRepo(repoPath);
  const current = repo.fullName.split("/").pop() ?? "";
  const [name, setName] = useState(current);
  const valid = /^[A-Za-z0-9._-]+$/.test(name.trim());
  const changed = name.trim() !== current;

  return (
    <Row title="Rename repository" desc="Old links and clones keep working.">
      <div className="flex shrink-0 items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-44 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!valid || !changed || rename.isPending}
          onClick={() =>
            rename.mutate(name.trim(), {
              onSuccess: () =>
                toast.success(`Renamed to ${name.trim()} — links redirect`),
              onError: toastError,
            })
          }
        >
          {rename.isPending && <Spinner data-icon="inline-start" />}
          Rename
        </Button>
      </div>
    </Row>
  );
}

function ArchiveAction({
  repoPath,
  repo,
}: {
  repoPath: string;
  repo: RepoSettings;
}) {
  const setArchived = useSetArchived(repoPath);
  const [confirming, setConfirming] = useState(false);
  const archived = repo.archived;

  return (
    <Row
      title={archived ? "Unarchive repository" : "Archive repository"}
      desc={
        archived
          ? "Make the repository writable again."
          : "Make the repository read-only. Reversible."
      }
    >
      {confirming ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
          <Button
            variant={archived ? "default" : "destructive"}
            size="sm"
            disabled={setArchived.isPending}
            onClick={() =>
              setArchived.mutate(!archived, {
                onSuccess: () => {
                  toast.success(
                    archived ? "Repository unarchived" : "Repository archived",
                  );
                  setConfirming(false);
                },
                onError: toastError,
              })
            }
          >
            {setArchived.isPending && <Spinner data-icon="inline-start" />}
            {archived ? "Unarchive" : "Archive"}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setConfirming(true)}
        >
          {archived ? "Unarchive" : "Archive"}
        </Button>
      )}
    </Row>
  );
}

const VISIBILITIES = ["public", "private", "internal"];

function VisibilityAction({
  repoPath,
  repo,
}: {
  repoPath: string;
  repo: RepoSettings;
}) {
  const setVisibility = useSetVisibility(repoPath);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(repo.visibility || "public");

  return (
    <Row
      title="Change repository visibility"
      desc={`Currently ${repo.visibility || "unknown"}.`}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setTarget(repo.visibility || "public");
          setOpen(true);
        }}
      >
        Change visibility
      </Button>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Change visibility"
        description="Changing visibility erases this repo's stars and watchers. Making it public exposes all code and history; making it private detaches existing forks, unpublishes Pages, and disables push rulesets."
        confirmPhrase={repo.fullName}
        confirmLabel="Change visibility"
        disabled={target === repo.visibility}
        pending={setVisibility.isPending}
        onConfirm={() =>
          setVisibility.mutate(target, {
            onSuccess: () => {
              toast.success(`Repository is now ${target}`);
              setOpen(false);
            },
            onError: toastError,
          })
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="visibility-target" className="text-xs">
            New visibility
          </Label>
          <Select value={target} onValueChange={(v) => v && setTarget(v)}>
            <SelectTrigger id="visibility-target" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITIES.map((v) => (
                <SelectItem key={v} value={v} className="capitalize">
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            “Internal” requires the organization to belong to an enterprise.
          </p>
        </div>
      </DangerDialog>
    </Row>
  );
}

function TransferAction({
  repoPath,
  repo,
}: {
  repoPath: string;
  repo: RepoSettings;
}) {
  const transfer = useTransferRepo(repoPath);
  const [open, setOpen] = useState(false);
  const [newOwner, setNewOwner] = useState("");

  return (
    <Row
      title="Transfer ownership"
      desc="Move this repository to another user or organization."
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Transfer
      </Button>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Transfer repository"
        description="Transferring moves the repo (and its issues, PRs, stars, and settings) to the new owner. Transferring to a personal account requires them to accept; you'll lose admin access here."
        confirmPhrase={repo.fullName}
        confirmLabel="Transfer"
        disabled={!newOwner.trim()}
        pending={transfer.isPending}
        onConfirm={() =>
          transfer.mutate(
            { newOwner: newOwner.trim(), newName: null },
            {
              onSuccess: () => {
                toast.success("Transfer requested");
                setOpen(false);
              },
              onError: toastError,
            },
          )
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="transfer-owner" className="text-xs">
            New owner (user or organization)
          </Label>
          <Input
            id="transfer-owner"
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            placeholder="username-or-org"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </DangerDialog>
    </Row>
  );
}

function DeleteAction({
  repoPath,
  repo,
}: {
  repoPath: string;
  repo: RepoSettings;
}) {
  const del = useDeleteRepo(repoPath);
  const [open, setOpen] = useState(false);

  return (
    <Row
      title="Delete this repository"
      desc="Permanently remove the repository on GitHub."
    >
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete repository"
        description="This permanently deletes the GitHub repository — its issues, pull requests, wiki, releases, and settings. Your local clone is left untouched. This cannot be undone."
        confirmPhrase={repo.fullName}
        confirmLabel="Delete forever"
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(undefined, {
            onSuccess: () => {
              toast.success("Repository deleted on GitHub");
              setOpen(false);
            },
            onError: toastError,
          })
        }
      >
        <ScopeRefreshHint scope="delete_repo" action="Deleting a repository" />
      </DangerDialog>
    </Row>
  );
}

/** Destructive lifecycle actions, at the bottom of the General tab (where GitHub
 *  puts them). Reuses the already-loaded repo settings. */
export function DangerZone({
  repoPath,
  open,
}: {
  repoPath: string;
  open: boolean;
}) {
  const settings = useRepoSettings(repoPath, open);
  if (!settings.data) return null;
  const repo = settings.data;

  return (
    <div className="mt-6 space-y-3 rounded-md border border-destructive/40 p-3">
      <h3 className="text-xs font-semibold text-destructive">Danger zone</h3>
      <RenameAction repoPath={repoPath} repo={repo} />
      <div className="border-t" />
      <ArchiveAction repoPath={repoPath} repo={repo} />
      <div className="border-t" />
      <VisibilityAction repoPath={repoPath} repo={repo} />
      <div className="border-t" />
      <TransferAction repoPath={repoPath} repo={repo} />
      <div className="border-t" />
      <DeleteAction repoPath={repoPath} repo={repo} />
    </div>
  );
}
