import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";
import { required, useAppForm, withForm } from "@/lib/form";
import { useGlobalIdentity, useSetGlobalIdentity } from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { settingsFormOpts } from "./settings-form";

/**
 * Global git identity (config --global user.name/email). Lives in gitconfig,
 * not app settings, so it applies immediately with its own Save — same
 * pattern as the API-key form.
 */
export function GitIdentitySection() {
  const identity = useGlobalIdentity();
  const setIdentity = useSetGlobalIdentity();

  const form = useAppForm({
    defaultValues: { name: "", email: "" },
    onSubmit: async ({ value }) => {
      try {
        await setIdentity.mutateAsync({
          name: value.name.trim(),
          email: value.email.trim(),
        });
        toast.success("Git identity updated");
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Seed once the saved identity arrives. keepDefaultValues: otherwise the
  // per-render options sync clobbers the seeded values (untouched form).
  const seed = useEffectEvent((name: string, email: string) =>
    form.reset({ name, email }, { keepDefaultValues: true }),
  );
  useEffect(() => {
    if (identity.data) seed(identity.data.name, identity.data.email);
  }, [identity.data]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">Git identity</h2>
        <p className="text-xs text-muted-foreground">
          The author on new commits in every repository (a repository's own git
          config can override it). Saved to your global git config and applied
          immediately.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <div className="grid max-w-xl grid-cols-2 gap-3">
          <form.AppField
            name="name"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField label="Name" placeholder="Your name" />
            )}
          </form.AppField>
          <form.AppField
            name="email"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField label="Email" placeholder="you@example.com" />
            )}
          </form.AppField>
        </div>
        <form.AppForm>
          <form.SubmitButton>Save identity</form.SubmitButton>
        </form.AppForm>
      </form>
    </section>
  );
}

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
