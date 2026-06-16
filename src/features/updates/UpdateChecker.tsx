import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSettings } from "@/lib/settings/queries";
import { checkForUpdate } from "@/lib/updater";
import { installUpdateWithToast } from "./install";

/**
 * Silent update check on launch (opt-out via Settings → Updates). When a newer
 * release exists it raises a persistent toast offering to install on consent —
 * never auto-installs. Runs once per app start; any failure (offline, no
 * release yet, endpoint not configured) is swallowed so it can't disrupt boot.
 */
export function UpdateChecker() {
  const settings = useSettings();
  const auto = settings.data?.autoCheckUpdates ?? true;
  const ranRef = useRef(false);

  useEffect(() => {
    if (!settings.data || ranRef.current) return;
    ranRef.current = true;
    if (!auto) return;
    checkForUpdate()
      .then((update) => {
        if (!update) return;
        toast(`Update available: v${update.version}`, {
          description: "A new version of GitDesktop is ready to install.",
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: "Install & restart",
            onClick: () => void installUpdateWithToast(update),
          },
        });
      })
      .catch(() => {
        // Offline / no published release / endpoint not set up — stay quiet.
      });
  }, [settings.data, auto]);

  return null;
}
