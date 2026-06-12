import { Popover } from "@base-ui/react/popover";
import { UsersIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCoAuthorInput } from "@/lib/git/co-authors";
import { useCommitAuthors, useUserIdentity } from "@/lib/git/queries";
import type { CommitAuthor } from "@/lib/git/types";

/**
 * Co-author chips + an "add" popover fed by the repo's commit authors.
 * Trigger renders before the chips so it never shifts as they come and go.
 */
export function CoAuthorPicker({
  repoPath,
  value,
  onChange,
  disabled,
}: {
  repoPath: string;
  value: CommitAuthor[];
  onChange: (coAuthors: CommitAuthor[]) => void;
  disabled?: boolean;
}) {
  const authors = useCommitAuthors(repoPath);
  const identity = useUserIdentity(repoPath);
  const [query, setQuery] = useState("");

  // The commit author is already credited — never offer them as a co-author.
  const selfEmail = identity.data?.email.toLowerCase() || null;
  const selectedEmails = new Set(value.map((a) => a.email.toLowerCase()));
  const q = query.trim().toLowerCase();
  const otherAuthors = (authors.data ?? []).filter(
    (a) => a.email.toLowerCase() !== selfEmail,
  );
  const suggestions = otherAuthors
    .filter((a) => !selectedEmails.has(a.email.toLowerCase()))
    .filter(
      (a) =>
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q),
    )
    .slice(0, 6);
  const parsed = parseCoAuthorInput(query);
  const typedSelf = parsed !== null && parsed.email.toLowerCase() === selfEmail;
  const canAddTyped =
    parsed !== null &&
    !typedSelf &&
    !selectedEmails.has(parsed.email.toLowerCase());

  function add(author: CommitAuthor) {
    onChange([...value, author]);
    setQuery("");
  }

  function remove(email: string) {
    onChange(value.filter((a) => a.email !== email));
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Prefer the typed "Name <email>" when it parses; else the top match.
    if (canAddTyped && parsed) add(parsed);
    else if (suggestions[0]) add(suggestions[0]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label="Add co-authors"
              title="Credit co-authors on this commit"
            />
          }
        >
          <UsersIcon data-icon="inline-start" />
          Co-authors
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            align="start"
            sideOffset={4}
            className="isolate z-50"
          >
            <Popover.Popup className="w-96 rounded-none bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <p className="pb-2 text-sm font-medium">Add a co-author</p>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search, or Name <email>"
                autoComplete="off"
              />
              <div className="mt-2 space-y-px">
                {canAddTyped && parsed && (
                  <button
                    type="button"
                    className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/60"
                    onClick={() => add(parsed)}
                  >
                    <span className="font-medium">Add "{parsed.name}"</span>
                    <span className="truncate text-muted-foreground">
                      {parsed.email}
                    </span>
                  </button>
                )}
                {suggestions.map((a) => (
                  <button
                    type="button"
                    key={a.email}
                    className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/60"
                    onClick={() => add(a)}
                  >
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="truncate text-muted-foreground">
                      {a.email}
                    </span>
                  </button>
                ))}
                {typedSelf && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    That's you — the commit author is already credited.
                  </p>
                )}
                {suggestions.length === 0 && !canAddTyped && !typedSelf && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {q
                      ? "No matches — type Name <email@example.com>"
                      : otherAuthors.length > 0
                        ? "Everyone from this repo's history is already added."
                        : "No other authors found in this repo's history."}
                  </p>
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {value.map((a) => (
        <span
          key={a.email}
          className="flex items-center gap-1 border px-1.5 py-0.5 text-[11px]"
          title={`${a.name} <${a.email}>`}
        >
          {a.name}
          <button
            type="button"
            aria-label={`Remove co-author ${a.name}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => remove(a.email)}
            disabled={disabled}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
