import { SparkleIcon } from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { required, useAppForm } from "@/lib/form";
import { usePublishRepo } from "@/lib/git/queries";
import { useAiEnabled } from "@/lib/settings/queries";
import { toastError } from "@/lib/toast";
import { useGenerateRepoDescription } from "../repo-settings/useGenerateRepoDescription";

/** Space/comma-separated text → GitHub's lowercase, deduped, capped topic list.
 *  Mirrors GeneralSettingsSection's parser (GitHub normalizes topics the same). */
function parseTopics(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, ""))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

export function PublishDialog({
  repoPath,
  defaultName,
  open,
  onOpenChange,
}: {
  repoPath: string;
  defaultName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const publish = usePublishRepo(repoPath);
  const aiEnabled = useAiEnabled();
  const descGen = useGenerateRepoDescription(repoPath);

  const form = useAppForm({
    defaultValues: {
      name: defaultName,
      description: "",
      homepage: "",
      topics: "",
      isPrivate: true,
    },
    onSubmit: async ({ value }) => {
      try {
        const url = await publish.mutateAsync({
          name: value.name.trim(),
          isPrivate: value.isPrivate,
          description: value.description,
          homepage: value.homepage.trim(),
          topics: parseTopics(value.topics),
        });
        toast.success(`Published ${value.name.trim()}`, {
          description: url,
          action: { label: "View", onClick: () => openUrl(url) },
        });
        onOpenChange(false);
      } catch (e) {
        toastError(e);
      }
    },
  });

  // The live name drives the AI grounding (the repo isn't published yet).
  const nameVal = useSelector(form.store, (s) => s.values.name);

  const seedOnOpen = useEffectEvent(() =>
    form.reset({
      name: defaultName,
      description: "",
      homepage: "",
      topics: "",
      isPrivate: true,
    }),
  );
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Publish repository</DialogTitle>
            <DialogDescription>
              Creates a GitHub repository, adds it as{" "}
              <span className="font-mono">origin</span>, and pushes the current
              branch. Use <span className="font-mono">owner/name</span> to
              publish under an organization.
            </DialogDescription>
          </DialogHeader>
          <form.AppField
            name="name"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField label="Name" placeholder="my-project" />
            )}
          </form.AppField>

          {aiEnabled && (
            <div className="flex justify-end">
              {descGen.generating ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={descGen.cancel}
                >
                  <Spinner data-icon="inline-start" />
                  Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    descGen.generate({
                      repoName: nameVal.trim() || defaultName,
                      onResult: ({ description, topics }) => {
                        if (description) {
                          form.setFieldValue("description", description);
                        }
                        if (topics.length) {
                          form.setFieldValue("topics", topics.join(" "));
                        }
                      },
                    })
                  }
                  title="Suggest a description + topics from the README with AI"
                >
                  <SparkleIcon data-icon="inline-start" />
                  Generate description &amp; topics
                </Button>
              )}
            </div>
          )}

          <form.AppField name="description">
            {(field) => (
              <field.TextField
                label="Description (optional)"
                placeholder="What is this project?"
              />
            )}
          </form.AppField>
          <form.AppField name="topics">
            {(field) => (
              <field.TextField
                label="Topics (optional, separate with spaces)"
                placeholder="react typescript cli"
              />
            )}
          </form.AppField>
          <form.AppField name="homepage">
            {(field) => (
              <field.TextField
                label="Homepage (optional)"
                placeholder="https://…"
              />
            )}
          </form.AppField>

          <DialogFooter className="sm:items-center">
            <form.AppField name="isPrivate">
              {(field) => (
                <field.CheckboxField
                  label="Keep this code private"
                  className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
                />
              )}
            </form.AppField>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton disabled={descGen.generating}>
                Publish
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
