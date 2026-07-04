import { Popover } from "@base-ui/react/popover";
import { UserCheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useReviewerCandidates } from "@/lib/git/queries";
import type { ForgeUserRef } from "@/lib/git/types";

/**
 * Reviewer multi-select for the PR view (Bitbucket-only —
 * `implemented.mrReviewers`). Mirrors `AssigneesPopover`, with one structural
 * difference: entries are `{id, label}` pairs, not bare login strings — Bitbucket
 * identity must travel as the account uuid (nicknames aren't unique and
 * participant objects never carry `username`), while the label stays human.
 *
 * Edits batch into one `onChange` when the popover closes (each change is a
 * network PUT, like the assignees picker in the view). Candidates load only while
 * the popover is enabled; the PR author is already filtered out server-side (the
 * backend excludes them — Bitbucket rejects an author-reviewer).
 */
export function ReviewersPopover({
  repoPath,
  number,
  enabled,
  value,
  onChange,
}: {
  repoPath: string;
  number: number;
  enabled: boolean;
  value: ForgeUserRef[];
  onChange: (next: ForgeUserRef[]) => void;
}) {
  const candidates = useReviewerCandidates(repoPath, number, enabled);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Map<string, ForgeUserRef>>(new Map());

  function toggle(user: ForgeUserRef, on: boolean) {
    setDraft((prev) => {
      const next = new Map(prev);
      if (on) next.set(user.id, user);
      else next.delete(user.id);
      return next;
    });
  }

  function handleOpenChange(o: boolean) {
    if (o) {
      setDraft(new Map(value.map((r) => [r.id, r])));
      setOpen(true);
      return;
    }
    setOpen(false);
    onChange([...draft.values()]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger
          render={
            <Button variant="ghost" size="xs" aria-label="Edit reviewers" />
          }
        >
          <UserCheckIcon data-icon="inline-start" />
          Reviewers
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            align="start"
            sideOffset={4}
            className="isolate z-50"
          >
            <Popover.Popup className="w-60 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <p className="px-1 pb-1.5 text-xs font-medium">Reviewers</p>
              {(candidates.data ?? []).length === 0 && (
                <p className="px-1 py-1 text-xs text-muted-foreground">
                  {candidates.isPending
                    ? "Loading…"
                    : candidates.isError
                      ? "Couldn't load workspace members."
                      : "No eligible reviewers — the workspace has no other members."}
                </p>
              )}
              {(candidates.data ?? []).map((user) => (
                <label
                  key={user.id}
                  className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-xs hover:bg-muted/60"
                >
                  <Checkbox
                    checked={draft.has(user.id)}
                    onCheckedChange={(v) => toggle(user, v === true)}
                  />
                  <span className="flex-1 truncate">{user.label}</span>
                </label>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {value.map((user) => (
        <span
          key={user.id}
          className="border px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          {user.label}
        </span>
      ))}
    </div>
  );
}
