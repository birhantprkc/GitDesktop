import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";
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
  useGlRepoSettings,
  useRenameRepo,
  useRepoAdmin,
  useRepoSettings,
  useSetArchived,
  useSetVisibility,
  useTransferRepo,
} from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { InlineConfirm } from "./parts";
import { ScopeRefreshHint } from "./ScopeRefreshHint";

/** The provider-neutral facts the danger actions need, sourced from whichever
 *  provider's settings read is active. */
interface DangerInfo {
  /** "owner/repo" (GitHub) or the full project path (GitLab) — the confirm phrase. */
  fullName: string;
  /** What the rename input starts from (GitHub repo name / GitLab path slug). */
  currentName: string;
  archived: boolean;
  visibility: string;
}

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

const OWNER_HINT = "Needs the Owner role on GitLab";

/** A danger-zone trigger whose disabled state still explains itself: the
 *  vendored Button renders a NATIVE `disabled`, which swallows pointer events
 *  (so a `title` on the button never shows) — the hint rides a wrapping span. */
function DangerButton({
  hint,
  className,
  ...props
}: ComponentProps<typeof Button> & { hint?: string }) {
  return (
    <span title={hint} className={cn("inline-flex", className)}>
      <Button size="sm" {...props} />
    </span>
  );
}

function RenameAction({
  repoPath,
  info,
  isGitLab,
}: {
  repoPath: string;
  info: DangerInfo;
  isGitLab: boolean;
}) {
  const rename = useRenameRepo(repoPath);
  const current = info.currentName;
  const [name, setName] = useState(current);
  // GitLab paths must start alphanumeric; GitHub allows a leading `.`/`_`/`-`
  // (".github" is a standard repo name) — the check branches so GitHub keeps
  // its full grammar.
  const valid = isGitLab
    ? /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name.trim())
    : /^[A-Za-z0-9._-]+$/.test(name.trim());
  const changed = name.trim() !== current;

  return (
    <Row
      title={isGitLab ? "Rename project" : "Rename repository"}
      desc={
        isGitLab
          ? "Renames the name and path; old paths redirect."
          : "Old links and clones keep working."
      }
    >
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
  info,
  isGitLab,
  isOwner,
}: {
  repoPath: string;
  info: DangerInfo;
  isGitLab: boolean;
  isOwner: boolean;
}) {
  const setArchived = useSetArchived(repoPath);
  const [confirming, setConfirming] = useState(false);
  const archived = info.archived;
  // Sentence-cased for toasts, lowercase mid-sentence — GitHub copy unchanged.
  const noun = isGitLab ? "project" : "repository";
  const nounCap = isGitLab ? "Project" : "Repository";

  return (
    <Row
      title={archived ? `Unarchive ${noun}` : `Archive ${noun}`}
      desc={
        archived
          ? `Make the ${noun} writable again.`
          : `Make the ${noun} read-only. Reversible.`
      }
    >
      {confirming ? (
        <div className="flex shrink-0 items-center gap-2">
          <InlineConfirm
            actLabel={archived ? "Unarchive" : "Archive"}
            actVariant={archived ? "default" : "destructive"}
            pending={setArchived.isPending}
            onCancel={() => setConfirming(false)}
            onAct={() =>
              setArchived.mutate(!archived, {
                onSuccess: () => {
                  toast.success(
                    archived ? `${nounCap} unarchived` : `${nounCap} archived`,
                  );
                  setConfirming(false);
                },
                onError: toastError,
              })
            }
          />
        </div>
      ) : (
        <DangerButton
          variant="outline"
          disabled={!isOwner}
          hint={isOwner ? undefined : OWNER_HINT}
          className="shrink-0"
          onClick={() => setConfirming(true)}
        >
          {archived ? "Unarchive" : "Archive"}
        </DangerButton>
      )}
    </Row>
  );
}

const VISIBILITIES = ["public", "private", "internal"];

function VisibilityAction({
  repoPath,
  info,
  isGitLab,
  isOwner,
}: {
  repoPath: string;
  info: DangerInfo;
  isGitLab: boolean;
  isOwner: boolean;
}) {
  const setVisibility = useSetVisibility(repoPath);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(info.visibility || "public");

  return (
    <Row
      title={
        isGitLab ? "Change project visibility" : "Change repository visibility"
      }
      desc={`Currently ${info.visibility || "unknown"}.`}
    >
      <DangerButton
        variant="outline"
        disabled={!isOwner}
        hint={isOwner ? undefined : OWNER_HINT}
        onClick={() => {
          setTarget(info.visibility || "public");
          setOpen(true);
        }}
      >
        Change visibility
      </DangerButton>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title="Change visibility"
        description={
          isGitLab
            ? "Making a project public exposes all code, issues, and history; making it private hides it from everyone without access and unlinks existing forks."
            : "Changing visibility erases this repo's stars and watchers. Making it public exposes all code and history; making it private detaches existing forks, unpublishes Pages, and disables push rulesets."
        }
        confirmPhrase={info.fullName}
        confirmLabel="Change visibility"
        disabled={target === info.visibility}
        pending={setVisibility.isPending}
        onConfirm={() =>
          setVisibility.mutate(target, {
            onSuccess: () => {
              toast.success(
                `${isGitLab ? "Project" : "Repository"} is now ${target}`,
              );
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
            {isGitLab
              ? "“Internal” is limited to self-managed GitLab (gitlab.com disallows it for new projects)."
              : "“Internal” requires the organization to belong to an enterprise."}
          </p>
        </div>
      </DangerDialog>
    </Row>
  );
}

function TransferAction({
  repoPath,
  info,
  isGitLab,
  isOwner,
}: {
  repoPath: string;
  info: DangerInfo;
  isGitLab: boolean;
  isOwner: boolean;
}) {
  const transfer = useTransferRepo(repoPath);
  const [open, setOpen] = useState(false);
  const [newOwner, setNewOwner] = useState("");

  return (
    <Row
      title="Transfer ownership"
      desc={
        isGitLab
          ? "Move this project to another group or user namespace."
          : "Move this repository to another user or organization."
      }
    >
      <DangerButton
        variant="outline"
        disabled={!isOwner}
        hint={isOwner ? undefined : OWNER_HINT}
        onClick={() => setOpen(true)}
      >
        Transfer
      </DangerButton>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title={isGitLab ? "Transfer project" : "Transfer repository"}
        description={
          isGitLab
            ? "Transferring moves the project (and its issues, merge requests, and settings) to the new namespace — a group you own or maintain. The project URL changes; old paths redirect."
            : "Transferring moves the repo (and its issues, PRs, stars, and settings) to the new owner. Transferring to a personal account requires them to accept; you'll lose admin access here."
        }
        confirmPhrase={info.fullName}
        confirmLabel="Transfer"
        disabled={!newOwner.trim()}
        pending={transfer.isPending}
        onConfirm={() =>
          transfer.mutate(
            { newOwner: newOwner.trim(), newName: null },
            {
              onSuccess: () => {
                toast.success(
                  isGitLab ? "Project transferred" : "Transfer requested",
                );
                setOpen(false);
              },
              onError: toastError,
            },
          )
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="transfer-owner" className="text-xs">
            {isGitLab
              ? "New namespace (group path or username)"
              : "New owner (user or organization)"}
          </Label>
          <Input
            id="transfer-owner"
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            placeholder={
              isGitLab ? "group/subgroup or username" : "username-or-org"
            }
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
  info,
  isGitLab,
  isOwner,
}: {
  repoPath: string;
  info: DangerInfo;
  isGitLab: boolean;
  isOwner: boolean;
}) {
  const del = useDeleteRepo(repoPath);
  const [open, setOpen] = useState(false);
  const noun = isGitLab ? "project" : "repository";

  return (
    <Row
      title={`Delete this ${noun}`}
      desc={`Permanently remove the ${noun} on ${isGitLab ? "GitLab" : "GitHub"}.`}
    >
      <DangerButton
        variant="destructive"
        disabled={!isOwner}
        hint={isOwner ? undefined : OWNER_HINT}
        onClick={() => setOpen(true)}
      >
        Delete
      </DangerButton>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${noun}`}
        description={
          isGitLab
            ? "This permanently deletes the GitLab project — its issues, merge requests, wiki, releases, and settings. gitlab.com may delay the deletion briefly (the project is scheduled for removal). Your local clone is left untouched."
            : "This permanently deletes the GitHub repository — its issues, pull requests, wiki, releases, and settings. Your local clone is left untouched. This cannot be undone."
        }
        confirmPhrase={info.fullName}
        confirmLabel="Delete forever"
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(undefined, {
            onSuccess: () => {
              toast.success(
                isGitLab
                  ? "Project deleted on GitLab"
                  : "Repository deleted on GitHub",
              );
              setOpen(false);
            },
            onError: toastError,
          })
        }
      >
        {!isGitLab && (
          <ScopeRefreshHint
            scope="delete_repo"
            action="Deleting a repository"
          />
        )}
      </DangerDialog>
    </Row>
  );
}

/** Destructive lifecycle actions, at the bottom of the settings rail. Works for
 *  both providers: the mutations dispatch behind the abstraction, and GitLab's
 *  Owner-only actions (archive / visibility / transfer / delete) disable with
 *  an explanation for Maintainers. */
export function DangerZone({
  repoPath,
  open,
  provider,
}: {
  repoPath: string;
  open: boolean;
  provider: "github" | "gitlab";
}) {
  const isGitLab = provider === "gitlab";
  const gh = useRepoSettings(repoPath, open && !isGitLab);
  const gl = useGlRepoSettings(repoPath, open && isGitLab);
  // Owner gating (GitLab): the same probe the menu item used, so it's cached.
  const admin = useRepoAdmin(repoPath, open && isGitLab);

  const info: DangerInfo | null = isGitLab
    ? gl.data
      ? {
          fullName: gl.data.fullName,
          currentName: gl.data.path,
          archived: gl.data.archived,
          visibility: gl.data.visibility,
        }
      : null
    : gh.data
      ? {
          fullName: gh.data.fullName,
          currentName: gh.data.fullName.split("/").pop() ?? "",
          archived: gh.data.archived,
          visibility: gh.data.visibility,
        }
      : null;
  if (!info) return null;
  const isOwner = !isGitLab || (admin.data?.owner ?? false);

  return (
    <div className="space-y-3 rounded-md border border-destructive/40 p-3">
      <h3 className="text-xs font-semibold text-destructive">Danger zone</h3>
      <RenameAction repoPath={repoPath} info={info} isGitLab={isGitLab} />
      <div className="border-t" />
      <ArchiveAction
        repoPath={repoPath}
        info={info}
        isGitLab={isGitLab}
        isOwner={isOwner}
      />
      <div className="border-t" />
      <VisibilityAction
        repoPath={repoPath}
        info={info}
        isGitLab={isGitLab}
        isOwner={isOwner}
      />
      <div className="border-t" />
      <TransferAction
        repoPath={repoPath}
        info={info}
        isGitLab={isGitLab}
        isOwner={isOwner}
      />
      <div className="border-t" />
      <DeleteAction
        repoPath={repoPath}
        info={info}
        isGitLab={isGitLab}
        isOwner={isOwner}
      />
    </div>
  );
}
