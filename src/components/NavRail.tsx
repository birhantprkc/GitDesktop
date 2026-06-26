import { useMemo } from "react";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { cn } from "@/lib/utils";

export interface NavRailItem {
  id: string;
  label: string;
  /** Render in the destructive palette (e.g. a Danger zone entry). */
  destructive?: boolean;
}

export interface NavRailGroup {
  /** Optional uppercase group header; omit for a flat, header-less list. */
  label?: string;
  /** Draw a top divider above the group (e.g. to set off a Danger zone). */
  separated?: boolean;
  items: NavRailItem[];
}

/**
 * The app's vertical section rail — the left-hand list of selectable sections
 * shared by Settings, Repository settings, and the user guide. One implementation
 * so the keyboard model and styling never drift: ArrowUp/ArrowDown rove between
 * items (roving tabindex), Tab leaves the rail, and the active item carries
 * `aria-current="page"`. Pass `className` for the container box (width, border,
 * overflow); the rail owns the inner structure.
 */
export function NavRail({
  groups,
  activeId,
  onSelect,
  ariaLabel,
  className,
}: {
  groups: NavRailGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const ids = useMemo(
    () => groups.flatMap((g) => g.items.map((i) => i.id)),
    [groups],
  );
  const onKeyDown = listKeyboardNav<string>({
    items: ids,
    activeIndex: ids.indexOf(activeId),
    onActivate: onSelect,
    rowKey: (id) => id,
    rowAttr: "data-rail-item",
  });

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("shrink-0 space-y-3", className)}
      onKeyDown={onKeyDown}
    >
      {groups.map((group, gi) => (
        <div
          key={group.label ?? group.items[0]?.id ?? gi}
          className={cn("space-y-0.5", group.separated && "border-t pt-3")}
        >
          {group.label && (
            <p className="px-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                data-rail-item={item.id}
                // Roving tabindex: only the active item is tabbable; arrows move
                // within the rail, Tab leaves it for the content.
                tabIndex={active ? 0 : -1}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(item.id)}
                className={cn(
                  "block w-full px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active
                    ? item.destructive
                      ? "bg-destructive/10 font-medium text-destructive"
                      : "bg-accent font-medium text-accent-foreground"
                    : item.destructive
                      ? "text-destructive/80 hover:bg-destructive/5 hover:text-destructive"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
