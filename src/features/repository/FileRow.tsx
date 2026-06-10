import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { ChangeKind, FileEntry } from "@/lib/git/types";
import { cn } from "@/lib/utils";

const KIND_BADGE: Record<ChangeKind, { letter: string; className: string }> = {
  added: { letter: "A", className: "text-green-600 dark:text-green-400" },
  untracked: { letter: "U", className: "text-green-600 dark:text-green-400" },
  modified: { letter: "M", className: "text-amber-600 dark:text-amber-400" },
  typechange: { letter: "T", className: "text-amber-600 dark:text-amber-400" },
  deleted: { letter: "D", className: "text-red-600 dark:text-red-400" },
  renamed: { letter: "R", className: "text-blue-600 dark:text-blue-400" },
  copied: { letter: "C", className: "text-blue-600 dark:text-blue-400" },
  conflicted: { letter: "!", className: "text-destructive" },
};

export function FileRow({
  entry,
  kind,
  staged,
  selected,
  disabled,
  onSelect,
  onToggle,
}: {
  entry: FileEntry;
  kind: ChangeKind;
  staged: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const badge = KIND_BADGE[kind];
  const label = entry.origPath
    ? `${entry.origPath} → ${entry.path}`
    : entry.path;

  return (
    <div
      className={cn(
        "group flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-xs",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      role="button"
      tabIndex={0}
    >
      <span className={cn("w-3 shrink-0 font-semibold", badge.className)}>
        {badge.letter}
      </span>
      <span className="min-w-0 flex-1 truncate" title={label}>
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100"
        aria-label={staged ? `Unstage ${entry.path}` : `Stage ${entry.path}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {staged ? <MinusIcon /> : <PlusIcon />}
      </Button>
    </div>
  );
}
