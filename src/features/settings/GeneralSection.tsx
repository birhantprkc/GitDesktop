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
      </section>
    );
  },
});
