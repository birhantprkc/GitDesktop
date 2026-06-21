import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PRIVACY_POLICY_URL, resetAnalyticsId } from "@/lib/analytics";
import { withForm } from "@/lib/form";
import { settingsFormOpts } from "./settings-form";

export const GeneralSection = withForm({
  ...settingsFormOpts,
  render: function GeneralSectionRender({ form }) {
    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">General</h2>
          <p className="text-xs text-muted-foreground">App-wide preferences.</p>
        </div>
        {/* Each toggle is grouped with its own description (tight spacing) so
            the helper text reads as belonging to the control above it, not the
            next one down. */}
        <div className="space-y-1.5">
          <form.AppField name="hideAi">
            {(field) => (
              <field.CheckboxField
                label="Hide AI features"
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            Hides the AI commit-message and pull-request helpers, the AI review
            panel, and the AI and Automations settings sections. Your configured
            provider and API keys are kept — they're just not shown.
          </p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="closeToTray">
            {(field) => (
              <field.CheckboxField
                label="Keep running in the tray when the window is closed"
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            Closing the window hides GitDesktop to the system tray instead of
            quitting, so background work like AI reviews keeps running. Reopen
            from the tray icon, or use its Quit menu to exit. Turn this off to
            make closing quit the app.
          </p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="analyticsEnabled">
            {(field) => (
              <field.CheckboxField
                label="Send anonymous usage data"
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            Sends anonymous, content-free usage events to PostHog (EU region) to
            help improve the app. No code, file names, repo paths, or secrets
            are ever captured. Takes effect after saving.
          </p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="recordReplay">
            {(field) => (
              <field.CheckboxField
                label="Allow masked session recordings"
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            Off by default. Records your interactions to help diagnose issues —
            all text is masked and diffs, file content, and editors are blocked,
            so recordings never reveal what you're working on. Requires usage
            data above.
          </p>
        </div>
        <div className="flex items-center gap-4 pt-1">
          {PRIVACY_POLICY_URL && (
            <button
              type="button"
              className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => openUrl(PRIVACY_POLICY_URL)}
            >
              Privacy policy
            </button>
          )}
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={async () => {
              await resetAnalyticsId();
              toast.success("Analytics identity reset", {
                description:
                  "Future events use a new anonymous id, unlinkable from past ones.",
              });
            }}
          >
            Reset analytics identity
          </Button>
        </div>
      </section>
    );
  },
});
