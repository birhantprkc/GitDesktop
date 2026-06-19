import { Popover } from "@base-ui/react/popover";
import {
  CaretDownIcon,
  FlagIcon,
  ShapesIcon,
  TagIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { LabelChip } from "@/features/conversations/Thread";
import {
  useAssignableUsers,
  useEditPrLabels,
  useIssueTypes,
  useMilestones,
  useRepoLabels,
} from "@/lib/git/queries";
import type { IssueType, RepoLabel } from "@/lib/git/types";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** GitHub issue-type color NAMES → a swatch hex (matches GitHub's palette). */
const ISSUE_TYPE_COLORS: Record<string, string> = {
  GRAY: "#6b7280",
  BLUE: "#3b82f6",
  GREEN: "#22c55e",
  YELLOW: "#eab308",
  ORANGE: "#f97316",
  RED: "#ef4444",
  PINK: "#ec4899",
  PURPLE: "#a855f7",
};

function typeColor(color: string): string {
  return ISSUE_TYPE_COLORS[color?.toUpperCase()] ?? ISSUE_TYPE_COLORS.GRAY;
}

function TypeDot({
  color,
  ...rest
}: { color: string } & ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: typeColor(color) }}
      {...rest}
    />
  );
}

/**
 * Assignee multi-select shared by the create dialog and the issue view.
 * `commitOnClose` batches edits into one `onChange` when the popover closes
 * (used in the view, where each change is a network PATCH); otherwise it fires
 * per toggle (used in the create dialog, where state is local).
 */
export function AssigneesPopover({
  repoPath,
  enabled,
  value,
  onChange,
  commitOnClose = false,
}: {
  repoPath: string;
  enabled: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  commitOnClose?: boolean;
}) {
  const users = useAssignableUsers(repoPath, enabled);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(value));
  const checked = commitOnClose ? draft : new Set(value);

  function toggle(login: string, on: boolean) {
    if (commitOnClose) {
      setDraft((prev) => {
        const next = new Set(prev);
        if (on) next.add(login);
        else next.delete(login);
        return next;
      });
      return;
    }
    const next = new Set(value);
    if (on) next.add(login);
    else next.delete(login);
    onChange([...next]);
  }

  function handleOpenChange(o: boolean) {
    if (o) {
      setDraft(new Set(value));
      setOpen(true);
      return;
    }
    setOpen(false);
    if (commitOnClose) onChange([...draft]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger
          render={
            <Button variant="ghost" size="xs" aria-label="Edit assignees" />
          }
        >
          <UserPlusIcon data-icon="inline-start" />
          Assignees
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            align="start"
            sideOffset={4}
            className="isolate z-50"
          >
            <Popover.Popup className="w-60 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <p className="px-1 pb-1.5 text-xs font-medium">Assignees</p>
              {(users.data ?? []).length === 0 && (
                <p className="px-1 py-1 text-xs text-muted-foreground">
                  {users.isPending ? "Loading…" : "No assignable users."}
                </p>
              )}
              {(users.data ?? []).map((login) => (
                <label
                  key={login}
                  className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-xs hover:bg-muted/60"
                >
                  <Checkbox
                    checked={checked.has(login)}
                    onCheckedChange={(v) => toggle(login, v === true)}
                  />
                  <span className="flex-1 truncate">{login}</span>
                </label>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {value.map((login) => (
        <span
          key={login}
          className="border px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          @{login}
        </span>
      ))}
    </div>
  );
}

/**
 * Single-select milestone menu. `valueLabel` shows the current title even when
 * it's a closed milestone (not in the open-milestone list).
 */
export function MilestoneMenu({
  repoPath,
  enabled,
  value,
  valueLabel,
  onChange,
}: {
  repoPath: string;
  enabled: boolean;
  value: number | null;
  valueLabel?: string;
  onChange: (milestone: number | null, title: string | null) => void;
}) {
  const milestones = useMilestones(repoPath, enabled);
  const list = milestones.data ?? [];
  const current = list.find((m) => m.number === value);
  const display =
    value === null
      ? "Milestone"
      : (current?.title ?? valueLabel ?? `#${value}`);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="xs" aria-label="Set milestone" />
          }
        >
          <FlagIcon data-icon="inline-start" />
          {display}
          <CaretDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuItem
            onClick={() => onChange(null, null)}
            className={cn(value === null && "bg-accent text-accent-foreground")}
          >
            No milestone
          </DropdownMenuItem>
          {list.map((m) => (
            <DropdownMenuItem
              key={m.number}
              onClick={() => onChange(m.number, m.title)}
              className={cn(
                value === m.number && "bg-accent text-accent-foreground",
              )}
            >
              {m.title}
            </DropdownMenuItem>
          ))}
          {list.length === 0 && (
            <DropdownMenuItem disabled>
              {milestones.isPending ? "Loading…" : "No open milestones"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Labels editor + chips, shared by the issue/PR meta surfaces. Edits are drafted
 * while the popover is open and committed as one batched mutation on close
 * (instant checkboxes, one network call). `labelableId` is the issue/PR node id.
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

/**
 * Single-select issue-type menu (org-defined Bug/Feature/Task/…). Renders
 * nothing when the repo's owner defines no types, so personal repos show no
 * empty control. `onChange` receives the type NAME (or null to clear).
 */
export function IssueTypeMenu({
  repoPath,
  enabled,
  value,
  onChange,
}: {
  repoPath: string;
  enabled: boolean;
  value: IssueType | null;
  onChange: (type: IssueType | null) => void;
}) {
  const types = useIssueTypes(repoPath, enabled);
  const list = types.data ?? [];
  // No types defined for this owner → hide the control entirely.
  if (list.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="xs" aria-label="Set issue type" />
          }
        >
          {value ? (
            <TypeDot color={value.color} data-icon="inline-start" />
          ) : (
            <ShapesIcon data-icon="inline-start" />
          )}
          {value?.name ?? "Type"}
          <CaretDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuItem
            onClick={() => onChange(null)}
            className={cn(!value && "bg-accent text-accent-foreground")}
          >
            No type
          </DropdownMenuItem>
          {list.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => onChange(t)}
              className={cn(
                value?.name === t.name && "bg-accent text-accent-foreground",
              )}
            >
              <TypeDot color={t.color} />
              {t.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
