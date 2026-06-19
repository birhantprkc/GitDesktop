import { Popover } from "@base-ui/react/popover";
import { TagIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { useEditPrLabels, useRepoLabels } from "@/lib/git/queries";
import type { RepoLabel } from "@/lib/git/types";
import { toastError } from "@/lib/toast";
import { LabelChip } from "./Thread";

/**
 * Labels editor + chips, shared by the issue and PR views (labels are a
 * Labelable, so the same `labelableId`-keyed mutation works for both). Edits are
 * drafted while the popover is open and committed as one batched mutation on
 * close — instant checkboxes, one network call.
 */
export function LabelsPopover({
  repoPath,
  enabled,
  labelableId,
  labels,
}: {
  repoPath: string;
  enabled: boolean;
  labelableId: string;
  labels: RepoLabel[];
}) {
  const repoLabels = useRepoLabels(repoPath, enabled);
  const editLabels = useEditPrLabels(repoPath);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());

  function toggleDraft(name: string, on: boolean) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function handleOpenChange(o: boolean) {
    if (o) {
      setDraft(new Set(labels.map((l) => l.name)));
      setOpen(true);
      return;
    }
    setOpen(false);
    const applied = new Set(labels.map((l) => l.name));
    const idByName = new Map(
      (repoLabels.data ?? []).map((l) => [l.name, l.id]),
    );
    const ids = (names: string[]) =>
      names.map((n) => idByName.get(n)).filter((id): id is string => !!id);
    const addIds = ids([...draft].filter((n) => !applied.has(n)));
    const removeIds = ids([...applied].filter((n) => !draft.has(n)));
    if (addIds.length > 0 || removeIds.length > 0) {
      editLabels.mutate(
        { labelableId, addIds, removeIds },
        { onError: toastError },
      );
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Trigger first, so it never shifts as chips come and go. */}
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger
          render={<Button variant="ghost" size="xs" aria-label="Edit labels" />}
        >
          {editLabels.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <TagIcon data-icon="inline-start" />
          )}
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
                    checked={draft.has(label.name)}
                    onCheckedChange={(v) => toggleDraft(label.name, v === true)}
                  />
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: `#${label.color}` }}
                  />
                  <span className="flex-1 truncate">{label.name}</span>
                </label>
              ))}
              {(repoLabels.data ?? []).length > 0 && (
                <p className="mt-1 border-t px-1 pt-1.5 text-[11px] text-muted-foreground">
                  Changes apply when this closes.
                </p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {labels.map((label) => (
        <LabelChip key={label.name} label={label} />
      ))}
    </div>
  );
}
