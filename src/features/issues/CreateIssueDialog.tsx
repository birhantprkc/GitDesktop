import { Popover } from "@base-ui/react/popover";
import { TagIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useEffectEvent, useState } from "react";
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
import { LabelChip } from "@/features/conversations/Thread";
import { required, useAppForm } from "@/lib/form";
import { useCreateIssue, useRepoLabels } from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { AssigneesPopover, MilestoneMenu } from "./IssueMetaPickers";

export function CreateIssueDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createIssue = useCreateIssue(repoPath);
  const repoLabels = useRepoLabels(repoPath, open);
  const selectIssue = useUiStore((s) => s.selectIssue);
  const [labels, setLabels] = useState<Set<string>>(new Set());
  const [assignees, setAssignees] = useState<string[]>([]);
  const [milestone, setMilestone] = useState<number | null>(null);

  const form = useAppForm({
    defaultValues: { title: "", body: "" },
    onSubmit: async ({ value }) => {
      try {
        const { number, url } = await createIssue.mutateAsync({
          title: value.title.trim(),
          body: value.body,
          labels: [...labels],
          assignees,
          milestone,
        });
        toast.success(`Opened issue #${number}`, {
          description: url,
          action: { label: "View", onClick: () => openUrl(url) },
        });
        onOpenChange(false);
        if (number > 0) selectIssue({ kind: "remote", id: String(number) });
      } catch (e) {
        toastError(e);
      }
    },
  });

  // keepDefaultValues: otherwise the per-render options sync clobbers the
  // reset values back to empty on an untouched form.
  const seedOnOpen = useEffectEvent(() => {
    form.reset({ title: "", body: "" }, { keepDefaultValues: true });
    setLabels(new Set());
    setAssignees([]);
    setMilestone(null);
  });
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  function toggleLabel(name: string, on: boolean) {
    setLabels((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  const selectedChips = (repoLabels.data ?? []).filter((l) =>
    labels.has(l.name),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create issue</DialogTitle>
            <DialogDescription>
              Opens a new issue on GitHub for this repository.
            </DialogDescription>
          </DialogHeader>

          <form.AppField
            name="title"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField
                label="Title"
                placeholder="Summarize the issue"
              />
            )}
          </form.AppField>
          <form.AppField name="body">
            {(field) => (
              <field.MarkdownField
                label="Description"
                placeholder="Describe the problem or request"
                rows={8}
                textareaClassName="max-h-72 min-h-24 resize-y font-mono"
              />
            )}
          </form.AppField>

          <div className="flex flex-wrap items-center gap-1.5">
            <Popover.Root>
              <Popover.Trigger
                render={
                  <Button variant="outline" size="xs" aria-label="Add labels" />
                }
              >
                <TagIcon data-icon="inline-start" />
                Labels
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  align="start"
                  sideOffset={4}
                  className="isolate z-50"
                >
                  <Popover.Popup className="w-60 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                    <p className="px-1 pb-1.5 text-xs font-medium">Labels</p>
                    {(repoLabels.data ?? []).length === 0 && (
                      <p className="px-1 py-1 text-xs text-muted-foreground">
                        {repoLabels.isPending
                          ? "Loading labels…"
                          : "This repository has no labels."}
                      </p>
                    )}
                    {(repoLabels.data ?? []).map((label) => (
                      <label
                        key={label.name}
                        className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-xs hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={labels.has(label.name)}
                          onCheckedChange={(v) =>
                            toggleLabel(label.name, v === true)
                          }
                        />
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: `#${label.color}` }}
                        />
                        <span className="flex-1 truncate">{label.name}</span>
                      </label>
                    ))}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            {selectedChips.map((label) => (
              <LabelChip key={label.name} label={label} />
            ))}
          </div>
          <AssigneesPopover
            repoPath={repoPath}
            enabled={open}
            value={assignees}
            onChange={setAssignees}
          />
          <MilestoneMenu
            repoPath={repoPath}
            enabled={open}
            value={milestone}
            onChange={setMilestone}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton>Create issue</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
