import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { installUpdateWithToast } from "@/features/updates/install";
import { withForm } from "@/lib/form";
import { toastError } from "@/lib/toast";
import { checkForUpdate } from "@/lib/updater";
import { settingsFormOpts } from "./settings-form";

export const UpdatesSection = withForm({
  ...settingsFormOpts,
  render: function UpdatesSectionRender({ form }) {
    const [version, setVersion] = useState("");
    const [checking, setChecking] = useState(false);

    useEffect(() => {
      getVersion()
        .then(setVersion)
        .catch(() => setVersion(""));
    }, []);

    async function checkNow() {
      setChecking(true);
      try {
        const update = await checkForUpdate();
        if (!update) {
          toast.success(
            version
              ? `You're on the latest version (v${version}).`
              : "You're on the latest version.",
          );
          return;
        }
        toast(`Update available: v${update.version}`, {
          description: "A new version of GitDesktop is ready to install.",
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: "Install & restart",
            onClick: () => void installUpdateWithToast(update),
          },
        });
      } catch (e) {
        toastError(e);
      } finally {
        setChecking(false);
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

        <form.AppField name="autoCheckUpdates">
          {(field) => (
            <field.CheckboxField
              label="Check for updates automatically on launch"
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
