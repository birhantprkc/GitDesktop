import { Popover } from "@base-ui/react/popover";
import { FunnelIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * The author/label filter popover shared by the PR and issue list panels: a
 * funnel trigger with an active-count badge, and Author/Label checkbox sections
 * with per-row counts. Driven entirely by `useLocalRemoteFilter`'s output.
 */
export function ConversationFilterPopover({
  authors,
  labels,
  authorFilter,
  labelFilter,
  toggle,
  activeFilterCount,
  authorCount,
  labelCount,
}: {
  authors: string[];
  labels: string[];
  authorFilter: Set<string>;
  labelFilter: Set<string>;
  toggle: (which: "author" | "label", value: string, on: boolean) => void;
  activeFilterCount: number;
  authorCount: (a: string) => number;
  labelCount: (l: string) => number;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={
              activeFilterCount > 0
                ? `Filter by author or label (${activeFilterCount} active)`
                : "Filter by author or label"
            }
            className="relative"
          />
        }
      >
        <FunnelIcon />
        {activeFilterCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center bg-primary text-[9px] font-medium text-primary-foreground tabular-nums"
          >
            {activeFilterCount}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={4} className="isolate z-50">
          <Popover.Popup className="w-60 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <p className="px-1 pb-1.5 text-xs font-medium">Author</p>
            {authors.length === 0 && (
              <p className="px-1 pb-1 text-xs text-muted-foreground">
                No authors to filter by.
              </p>
            )}
            {authors.map((a) => (
              <label
                key={a}
                className="flex cursor-pointer items-center gap-2 rounded-none px-1 py-1.5 text-xs hover:bg-muted/60"
              >
                <Checkbox
                  checked={authorFilter.has(a)}
                  onCheckedChange={(v) => toggle("author", a, v === true)}
                />
                <span className="flex-1 truncate" title={a}>
                  {a}
                </span>
                <span className="text-muted-foreground">
                  ({authorCount(a)})
                </span>
              </label>
            ))}
            <p className="px-1 pt-2 pb-1.5 text-xs font-medium">Label</p>
            {labels.length === 0 && (
              <p className="px-1 pb-1 text-xs text-muted-foreground">
                No labels to filter by.
              </p>
            )}
            {labels.map((l) => (
              <label
                key={l}
                className="flex cursor-pointer items-center gap-2 rounded-none px-1 py-1.5 text-xs hover:bg-muted/60"
              >
                <Checkbox
                  checked={labelFilter.has(l)}
                  onCheckedChange={(v) => toggle("label", l, v === true)}
                />
                <span className="flex-1 truncate" title={l}>
                  {l}
                </span>
                <span className="text-muted-foreground">({labelCount(l)})</span>
              </label>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
