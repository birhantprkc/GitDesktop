import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { installUpdateWithToast } from "@/features/updates/install";
import { useUpdateCheck } from "@/features/updates/useUpdateCheck";
import { withForm } from "@/lib/form";
import { toastError } from "@/lib/toast";
import { settingsFormOpts } from "./settings-form";

export const UpdatesSection = withForm({
  ...settingsFormOpts,
  render: function UpdatesSectionRender({ form }) {
    const [version, setVersion] = useState("");
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const updateCheck = useUpdateCheck();
    const update = updateCheck.data ?? null;

    useEffect(() => {
      getVersion()
        .then(setVersion)
        .catch(() => setVersion(""));
    }, []);

    async function checkNow() {
      setChecking(true);
      try {
        const res = await updateCheck.refetch();
        if (res.error) {
          toastError(res.error);
          return;
        }
        if (res.data === null) {
          toast.success(
            version
              ? `You're on the latest version (v${version}).`
              : "You're on the latest version.",
          );
        }
        // res.data non-null → the persistent banner renders above this button and
        // UpdateChecker raises the global once-per-version toast; nothing more here.
      } finally {
        setChecking(false);
      }
    }

    async function install() {
      if (!update) return;
      setInstalling(true);
      try {
        await installUpdateWithToast(update);
      } finally {
        // The app normally relaunches into the new version before this runs.
        setInstalling(false);
      }
    }

    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Updates</h2>
          <p className="text-xs text-muted-foreground">
            GitDesktop updates itself from GitHub Releases — signed and
            verified, installed only with your consent. Current version:{" "}
            <span className="font-mono">v{version || "…"}</span>.
          </p>
        </div>

        {update && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border border-primary/40 bg-primary/10 px-3 py-2"
          >
            <span className="flex items-center gap-2">
              <DownloadSimpleIcon className="size-4 shrink-0 text-primary" />
              <span className="text-xs">
                Update available:{" "}
                <span className="font-mono">v{update.version}</span> — ready to
                install.
              </span>
            </span>
            <Button size="xs" disabled={installing} onClick={install}>
              Install &amp; restart
            </Button>
          </div>
        )}

        <form.AppField name="autoCheckUpdates">
          {(field) => (
            <field.CheckboxField
              label="Check for updates automatically"
              className="flex cursor-pointer items-center gap-2 text-xs"
            />
          )}
        </form.AppField>

        <Button
          variant="outline"
          size="sm"
          onClick={checkNow}
          disabled={checking}
        >
          {checking && <Spinner data-icon="inline-start" />}
          Check for updates now
        </Button>
      </section>
    );
  },
});
