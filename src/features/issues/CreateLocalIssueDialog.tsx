import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
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
import { useCreateLocalIssue } from "@/lib/issues/queries";
import { useAiEnabled } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { useGenerateIssueDraft } from "./useGenerateIssueDraft";

export function CreateLocalIssueDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createIssue = useCreateLocalIssue(repoPath);
  const selectIssue = useUiStore((s) => s.selectIssue);
  const repoName = useUiStore((s) => s.repoName) ?? "";
  const aiEnabled = useAiEnabled();
  const { generate, cancel, generating } = useGenerateIssueDraft(repoPath);

  const form = useAppForm({
    defaultValues: { title: "", body: "" },
    onSubmit: async ({ value }) => {
      try {
        const issue = await createIssue.mutateAsync({
          title: value.title.trim(),
          body: value.body,
        });
        toast.success(`Created local issue: ${issue.title}`);
        selectIssue({ kind: "local", id: issue.id });
        onOpenChange(false);
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Live title/body drive the AI drafter's input and its enabled state.
  const titleVal = useSelector(form.store, (s) => s.values.title);
  const bodyVal = useSelector(form.store, (s) => s.values.body);
  const notes = [titleVal, bodyVal].filter(Boolean).join("\n\n");

  // keepDefaultValues: otherwise the per-render options sync clobbers the
  // reset values back to empty on an untouched form.
  const seedOnOpen = useEffectEvent(() => {
    form.reset({ title: "", body: "" }, { keepDefaultValues: true });
  });
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New local issue</DialogTitle>
            <DialogDescription>
              A private to-do for this repository, kept on your machine — no
              GitHub involved. Publish it later if it's worth sharing.
            </DialogDescription>
          </DialogHeader>

          <form.AppField
            name="title"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField
                label="Title"
                placeholder="Summarize the issue"
              />
            )}
          </form.AppField>
          <form.AppField name="body">
            {(field) => (
              <field.MarkdownField
                label="Description"
                placeholder="Jot down rough notes, then draft with AI"
                rows={8}
                textareaClassName="max-h-72 min-h-24 resize-y font-mono"
                actions={
                  !aiEnabled ? undefined : generating ? (
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
                      disabled={!notes.trim()}
                      onClick={() =>
                        generate({
                          notes,
                          repoName,
                          onResult: (d) => {
                            if (d.title) form.setFieldValue("title", d.title);
                            form.setFieldValue("body", d.body);
                          },
                        })
                      }
                      title="Expand your notes into a structured issue with AI"
                    >
                      <SparkleIcon data-icon="inline-start" />
                      Draft with AI
                    </Button>
                  )
                }
              />
            )}
          </form.AppField>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton disabled={generating}>
                Create local issue
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
