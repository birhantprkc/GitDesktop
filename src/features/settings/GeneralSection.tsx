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
          help improve the app. No code, file names, repo paths, or secrets are
          ever captured. Takes effect after saving.
        </p>
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
          so recordings never reveal what you're working on. Requires usage data
          above.
        </p>
        <div className="flex items-center gap-4 pt-1">
          {PRIVACY_POLICY_URL && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
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
