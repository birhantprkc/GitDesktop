import {
  ArrowBendUpLeftIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAddSubIssue,
  useIssueList,
  useIssueRelations,
  useRemoveSubIssue,
} from "@/lib/git/queries";
import type { IssueInfo } from "@/lib/git/types";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { CreateIssueDialog } from "./CreateIssueDialog";

/** Open/closed glyph for a related issue, so state isn't conveyed by text alone. */
function StateIcon({ state }: { state: string }) {
  return state === "CLOSED" ? (
    <CheckCircleIcon className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
  ) : (
    <CircleDashedIcon className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
  );
}

/**
 * Autocomplete over the repo's existing issues (open + closed), excluding the
 * ones that can't be added (self, parent, current sub-issues). Picking one fires
 * `onPick`. The lists only load while this is mounted (the picker is open).
 */
function AddExistingSubIssue({
  repoPath,
  exclude,
  pending,
  onPick,
}: {
  repoPath: string;
  exclude: Set<number>;
  pending: boolean;
  onPick: (n: number) => void;
}) {
  const open = useIssueList(repoPath, true, "open");
  const closed = useIssueList(repoPath, true, "closed");
  const candidates = [...(open.data ?? []), ...(closed.data ?? [])].filter(
    (i) => !exclude.has(i.number),
  );
  return (
    <Combobox
      items={candidates}
      itemToStringLabel={(i: IssueInfo) => `#${i.number} ${i.title}`}
      value={null}
      onValueChange={(item: IssueInfo | null) => item && onPick(item.number)}
      openOnInputClick
    >
      <ComboboxInput
        autoFocus
        className="w-full"
        placeholder="Search issues by # or title"
        disabled={pending}
      />
      <ComboboxContent>
        <ComboboxEmpty>No matching issues.</ComboboxEmpty>
        <ComboboxList>
          {(item: IssueInfo) => (
            <ComboboxItem key={item.number} value={item}>
              <StateIcon state={item.state} />
              <span className="text-muted-foreground">#{item.number}</span>
              <span className="truncate">{item.title}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * An issue's parent + sub-issues: a clickable parent breadcrumb, the sub-issue
 * checklist with its completion bar, and an "Add sub-issue" menu offering either
 * creating a new linked issue or attaching an existing one (autocomplete).
 * Sub-issues live only in GitHub's GraphQL API, so this loads independently of
 * the conversation view (mirrors the decoupled reactions query).
 */
export function IssueRelations({
  repoPath,
  issueId,
  number,
}: {
  repoPath: string;
  issueId: string;
  number: number;
}) {
  const relations = useIssueRelations(repoPath, number);
  const addSub = useAddSubIssue(repoPath);
  const removeSub = useRemoveSubIssue(repoPath);
  const selectIssue = useUiStore((s) => s.selectIssue);
  const [mode, setMode] = useState<null | "existing">(null);
  const [createOpen, setCreateOpen] = useState(false);

  const onError = (e: unknown) => toastError(e);
  const data = relations.data;

  // Wait for the first load so issues with no relationships don't flash an
  // empty section before it resolves.
  if (!data) return null;

  const { parent, subIssues, completed, total } = data;
  const exclude = new Set<number>([
    number,
    ...(parent ? [parent.number] : []),
    ...subIssues.map((s) => s.number),
  ]);

  function open(n: number) {
    selectIssue({ kind: "remote", id: String(n) });
  }

  function pickExisting(n: number) {
    addSub.mutate(
      { parentId: issueId, subNumber: n },
      { onSuccess: () => setMode(null), onError },
    );
  }

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="xs" aria-label="Add a sub-issue" />
        }
      >
        <PlusIcon data-icon="inline-start" />
        Add sub-issue
        <CaretDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem onClick={() => setCreateOpen(true)}>
          Create new sub-issue…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode("existing")}>
          Add existing issue…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-2 border-y py-3">
      {parent && (
        <button
          type="button"
          onClick={() => open(parent.number)}
          className="flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
          title={`Parent: #${parent.number} ${parent.title}`}
        >
          <ArrowBendUpLeftIcon className="size-3.5 shrink-0" />
          <span className="shrink-0">Parent</span>
          <StateIcon state={parent.state} />
          <span className="truncate">
            #{parent.number} {parent.title}
          </span>
        </button>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Sub-issues</span>
          {total > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {completed}/{total}
            </span>
          )}
          <span className="flex-1" />
          {mode === null && addMenu}
        </div>

        {total > 0 && (
          <div className="h-1 w-full bg-muted" aria-hidden>
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${(completed / total) * 100}%` }}
            />
          </div>
        )}

        {subIssues.map((s) => (
          <div key={s.id} className="group flex items-center gap-1.5 text-xs">
            <StateIcon state={s.state} />
            <button
              type="button"
              onClick={() => open(s.number)}
              className="min-w-0 flex-1 truncate text-left hover:underline"
              title={`#${s.number} ${s.title}`}
            >
              <span className="text-muted-foreground">#{s.number}</span>{" "}
              {s.title}
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove sub-issue #${s.number}`}
              className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() =>
                removeSub.mutate(
                  { parentId: issueId, subId: s.id },
                  { onError },
                )
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}

        {subIssues.length === 0 && mode === null && (
          <p className="text-[11px] text-muted-foreground">
            No sub-issues yet.
          </p>
        )}

        {mode === "existing" && (
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <AddExistingSubIssue
                repoPath={repoPath}
                exclude={exclude}
                pending={addSub.isPending}
                onPick={pickExisting}
              />
            </div>
            <Button variant="ghost" size="xs" onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      <CreateIssueDialog
        repoPath={repoPath}
        open={createOpen}
        onOpenChange={setCreateOpen}
        subIssueParentId={issueId}
      />
    </div>
  );
}
