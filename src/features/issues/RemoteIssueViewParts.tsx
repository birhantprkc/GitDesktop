import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import { Spinner } from "@/components/ui/spinner";
import { LabelsPopover } from "@/features/conversations/LabelsPopover";
import {
  useSetIssueAssignees,
  useSetIssueMilestone,
  useSetIssueType,
} from "@/lib/git/queries";
import type { IssueDetails } from "@/lib/git/types";
import { toastError } from "@/lib/toast";
import { IssueDevelopment } from "./IssueDevelopment";
import {
  AssigneesPopover,
  IssueTypeMenu,
  MilestoneMenu,
} from "./IssueMetaPickers";
import { IssueRelationships } from "./IssueRelations";

/** The issue's right-hand metadata rail: type / assignees / labels / milestone
 *  pickers (which it owns the mutations for), plus relationships, development,
 *  and the GitHub-only Projects/Notifications link-outs. */
export function IssueSidebar({
  repoPath,
  number,
  issue,
}: {
  repoPath: string;
  number: number;
  issue: IssueDetails;
}) {
  const setAssignees = useSetIssueAssignees(repoPath);
  const setMilestone = useSetIssueMilestone(repoPath);
  const setType = useSetIssueType(repoPath);
  const onError = (e: unknown) => toastError(e);

  return (
    <aside className="w-64 shrink-0 space-y-4 overflow-y-auto border-l p-4">
      <IssueTypeMenu
        repoPath={repoPath}
        enabled
        value={issue.issueType}
        onChange={(type) =>
          setType.mutate(
            { number, typeName: type?.name ?? null, type },
            { onError },
          )
        }
      />
      <AssigneesPopover
        repoPath={repoPath}
        enabled
        value={issue.assignees}
        commitOnClose
        onChange={(next) =>
          setAssignees.mutate({ number, assignees: next }, { onError })
        }
      />
      <LabelsPopover
        repoPath={repoPath}
        enabled
        labelableId={issue.id}
        labels={issue.labels}
      />
      <MilestoneMenu
        repoPath={repoPath}
        enabled
        value={issue.milestone?.number ?? null}
        valueLabel={issue.milestone?.title}
        onChange={(m, title) =>
          setMilestone.mutate({ number, milestone: m, title }, { onError })
        }
      />
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Projects</p>
        <button
          type="button"
          onClick={() => openUrl(issue.url)}
          className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          <ArrowSquareOutIcon className="size-3" />
          Manage on GitHub
        </button>
      </div>
      <IssueRelationships repoPath={repoPath} number={number} />
      <IssueDevelopment
        repoPath={repoPath}
        number={number}
        issueId={issue.id}
        issueTitle={issue.title}
        issueUrl={issue.url}
      />
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Notifications
        </p>
        <button
          type="button"
          onClick={() => openUrl(issue.url)}
          className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          <ArrowSquareOutIcon className="size-3" />
          Subscribe on GitHub
        </button>
      </div>
    </aside>
  );
}

/** Transfer-to-another-repo dialog. Presentational — the parent owns the
 *  mutation, the destination text, and the repo suggestions. */
export function TransferIssueDialog({
  open,
  onClose,
  number,
  dest,
  onDestChange,
  suggestions,
  pending,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  number: number;
  dest: string;
  onDestChange: (v: string) => void;
  suggestions: string[];
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Transfer issue #{number}</DialogTitle>
            <DialogDescription>
              Moves this issue to another repository you can push to. Its
              comments, labels, and assignees move with it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              autoFocus
              value={dest}
              onChange={(e) => onDestChange(e.target.value)}
              placeholder="owner/repo"
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <div className="max-h-40 overflow-auto border">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-muted/60"
                    onClick={() => onDestChange(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!dest.trim() || pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete-issue confirm dialog. Presentational — the parent owns the mutation. */
export function DeleteIssueDialog({
  open,
  onClose,
  number,
  title,
  pending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  number: number;
  title: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete issue #{number}?</DialogTitle>
          <DialogDescription>
            This permanently deletes “{title}” on GitHub. This cannot be undone,
            and requires admin or triage access.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending && <Spinner data-icon="inline-start" />}
            Delete issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
