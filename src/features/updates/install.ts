import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { installUpdate, type Update } from "@/lib/updater";

/**
 * Installs an update behind a live progress toast, then relaunches. Shared by
 * the launch check and the Settings "Check for updates" button so the install
 * UX is identical wherever the user starts it.
 */
export async function installUpdateWithToast(update: Update): Promise<void> {
  const id = toast.loading(`Downloading v${update.version}…`);
  try {
    await installUpdate(update, ({ downloaded, total }) => {
      const pct = total ? Math.round((downloaded / total) * 100) : null;
      toast.loading(
        pct !== null
          ? `Downloading v${update.version}… ${pct}%`
          : `Downloading v${update.version}…`,
        { id },
      );
    });
    // relaunch() restarts the app, so this rarely shows.
    toast.success("Update installed — restarting…", { id });
  } catch (e) {
    toast.dismiss(id);
    toastError(e);
  }
}
