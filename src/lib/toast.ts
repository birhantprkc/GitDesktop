import { toast } from "sonner";
import { errorMessage } from "@/lib/tauri/invoke";

const TOAST_MAX_LINES = 6;
const TOAST_MAX_CHARS = 400;

/** Keeps a long error (e.g. git/provider stderr) from ballooning the toast.
 *  The full text is still available via the Copy action. */
function clampForToast(text: string): string {
  let clamped = text.trim();
  let truncated = false;
  const lines = clamped.split("\n");
  if (lines.length > TOAST_MAX_LINES) {
    clamped = lines.slice(0, TOAST_MAX_LINES).join("\n");
    truncated = true;
  }
  if (clamped.length > TOAST_MAX_CHARS) {
    clamped = clamped.slice(0, TOAST_MAX_CHARS).trimEnd();
    truncated = true;
  }
  return truncated
    ? `${clamped}\n… (truncated — use Copy for the full text)`
    : clamped;
}

/**
 * Error toast with a Copy action — git/provider errors are often long and
 * worth pasting into a search or an issue.
 */
export function toastError(e: unknown) {
  const full = errorMessage(e);
  toast.error(clampForToast(full), {
    duration: 8000,
    action: {
      label: "Copy",
      onClick: () => {
        navigator.clipboard.writeText(full).catch(() => {
          // clipboard denied — nothing useful to do
        });
      },
    },
  });
}
