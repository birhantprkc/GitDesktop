import { CopyIcon } from "@phosphor-icons/react";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * A scrollable, monospace CI-log block with a copy button in a thin header strip.
 * Shared by the Actions panel (RunDetailView job logs + run failed logs) and the
 * PR checks rollup (ChecksRollup's inline peek) so logs read — and copy —
 * identically everywhere. The copy control lives in the header, not overlaid on
 * the scroll region, so it never collides with the log's scrollbar; it's hidden
 * when there's nothing to copy.
 */
export function LogBlock({
  text,
  emptyLabel = "No logs available.",
  maxHeightClass = "max-h-80",
  className,
}: {
  text: string;
  /** Shown (and left uncopyable) when the log is empty. */
  emptyLabel?: string;
  /** Tailwind max-height for the scroll region (call sites vary slightly). */
  maxHeightClass?: string;
  /** Applied to the outer wrapper — e.g. margin from the toggle above it. */
  className?: string;
}) {
  const trimmed = text.trim();
  return (
    <div className={cn("overflow-hidden border", className)}>
      {trimmed && (
        <div className="flex items-center justify-end border-b bg-muted/60 px-1.5 py-1">
          <button
            type="button"
            onClick={() => copyText(trimmed, "Logs copied")}
            title="Copy logs"
            className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
          >
            <CopyIcon className="size-3" />
            Copy
          </button>
        </div>
      )}
      <pre
        className={cn(
          "overflow-auto bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
          maxHeightClass,
        )}
      >
        {trimmed || emptyLabel}
      </pre>
    </div>
  );
}
