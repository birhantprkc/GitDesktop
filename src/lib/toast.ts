import { toast } from "sonner";
import { errorMessage } from "@/lib/tauri/invoke";

/**
 * Error toast with a Copy action — git/provider errors are often long and
 * worth pasting into a search or an issue.
 */
export function toastError(e: unknown) {
  const message = errorMessage(e);
  toast.error(message, {
    duration: 8000,
    action: {
      label: "Copy",
      onClick: () => {
        navigator.clipboard.writeText(message).catch(() => {
          // clipboard denied — nothing useful to do
        });
      },
    },
  });
}
