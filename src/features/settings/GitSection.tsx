import { withForm } from "@/lib/form";
import { settingsFormOpts } from "./settings-form";

export const GitSection = withForm({
  ...settingsFormOpts,
  render: function GitSectionRender({ form }) {
    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">Git</h2>
          <p className="text-xs text-muted-foreground">
            Defaults applied when creating new repositories.
          </p>
        </div>
        <form.AppField name="defaultBranch">
          {(field) => (
            <field.TextField
              label="Default branch for new repositories"
              placeholder="main"
              className="max-w-60 font-mono"
              warning={(value) =>
                value.startsWith("-") || value.trim().includes(" ")
                  ? "Branch names can't start with - or contain spaces."
                  : null
              }
            />
          )}
        </form.AppField>
      </section>
    );
  },
});
