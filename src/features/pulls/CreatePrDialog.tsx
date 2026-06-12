import { SparkleIcon, XIcon } from "@phosphor-icons/react";
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
import { required, useAppForm } from "@/lib/form";
import { useCreatePr } from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { useGeneratePrDescription } from "./useGeneratePrDescription";

export function CreatePrDialog({
  repoPath,
  base,
  head,
  commitSubjects,
  open,
  onOpenChange,
}: {
  repoPath: string;
  base: string;
  head: string;
  commitSubjects: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createPr = useCreatePr(repoPath);
  const { generate, cancel, generating } = useGeneratePrDescription(repoPath);

  const form = useAppForm({
    defaultValues: { title: "", body: "", draft: false },
    onSubmit: async ({ value }) => {
      try {
        const { number, url } = await createPr.mutateAsync({
          base,
          head,
          title: value.title.trim(),
          body: value.body,
          draft: value.draft,
        });
        toast.success(`Opened pull request #${number}`, {
          description: url,
          action: { label: "View", onClick: () => openUrl(url) },
        });
        onOpenChange(false);
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Seed fields each time the dialog opens (title GitHub-style: the single
  // commit's subject, else blank). An effect event so a background refresh
  // of the commit list can't clobber what the user is typing.
  // keepDefaultValues: otherwise the per-render options sync clobbers the
  // seeded title back to empty (untouched form).
  const seedOnOpen = useEffectEvent(() =>
    form.reset(
      {
        title: commitSubjects.length === 1 ? commitSubjects[0] : "",
        body: "",
        draft: false,
      },
      { keepDefaultValues: true },
    ),
  );
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create pull request</DialogTitle>
            <DialogDescription>
              Pushes <span className="font-mono">{head}</span> and opens a PR
              into <span className="font-mono">{base}</span> on GitHub
              {commitSubjects.length > 0 &&
                ` — ${commitSubjects.length} commit${commitSubjects.length === 1 ? "" : "s"}`}
              .
            </DialogDescription>
          </DialogHeader>
          <form.AppField
            name="title"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField
                label="Title"
                placeholder="Summarize the change"
              />
            )}
          </form.AppField>
          <form.AppField name="body">
            {(field) => (
              <field.MarkdownField
                label="Description"
                placeholder="Describe what changed and why"
                rows={8}
                textareaClassName="max-h-72 min-h-24 resize-y font-mono"
                actions={
                  generating ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={cancel}
                    >
                      <XIcon data-icon="inline-start" />
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        generate(base, head, commitSubjects, (d) => {
                          form.setFieldValue("title", d.title);
                          form.setFieldValue("body", d.body);
                        })
                      }
                      title="Generate the title and description with AI"
                    >
                      <SparkleIcon data-icon="inline-start" />
                      Generate
                    </Button>
                  )
                }
              />
            )}
          </form.AppField>
          <DialogFooter className="sm:items-center">
            <form.AppField name="draft">
              {(field) => (
                <field.CheckboxField
                  label="Create as draft"
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
              <form.Subscribe selector={(s) => s.values.draft}>
                {(draft) => (
                  <form.SubmitButton disabled={generating}>
                    {draft ? "Create draft" : "Create pull request"}
                  </form.SubmitButton>
                )}
              </form.Subscribe>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
