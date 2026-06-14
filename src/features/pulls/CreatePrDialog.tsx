import { SparkleIcon, XIcon } from "@phosphor-icons/react";
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
import { triggerAutomations } from "@/lib/automations/runner";
import { required, useAppForm } from "@/lib/form";
import {
  useBranches,
  useCompareBranches,
  useCreatePr,
  useDefaultBranch,
  useRepoStatus,
} from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { useGeneratePrDescription } from "./useGeneratePrDescription";

export function CreatePrDialog({
  repoPath,
  defaultBase,
  defaultHead,
  open,
  onOpenChange,
}: {
  repoPath: string;
  /** Seeds the base ("into") branch; defaults to the repo's default branch. */
  defaultBase?: string;
  /** Seeds the head ("merge") branch; defaults to the current branch. */
  defaultHead?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useRepoStatus(repoPath);
  const branches = useBranches(repoPath);
  const defaultBranch = useDefaultBranch(repoPath);
  const createPr = useCreatePr(repoPath);
  const { generate, cancel, generating } = useGeneratePrDescription(repoPath);

  const currentName = status.data?.branch?.name ?? null;
  const names = (branches.data ?? []).map((b) => b.name);

  const form = useAppForm({
    defaultValues: { head: "", base: "", title: "", body: "", draft: false },
    validators: {
      // Same branch on both sides proposes nothing — gate the submit.
      onChange: ({ value }) =>
        value.head === value.base ? "Pick two different branches." : undefined,
    },
    onSubmit: async ({ value }) => {
      try {
        const { number, url } = await createPr.mutateAsync({
          base: value.base,
          head: value.head,
          title: value.title.trim(),
          body: value.body,
          draft: value.draft,
        });
        toast.success(`Opened pull request #${number}`, {
          description: url,
          action: { label: "View", onClick: () => openUrl(url) },
        });
        onOpenChange(false);
        triggerAutomations({
          kind: "pr-open",
          repoPath,
          base: value.base,
          head: value.head,
          title: value.title.trim(),
          body: value.body,
          commitSubjects: ahead.map((c) => c.subject),
          target: { type: "remote", number },
        });
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Seed branches each time the dialog opens: head = current branch, base =
  // the default branch (or, when you're already on it, the first other branch).
  // keepDefaultValues: otherwise the per-render options sync clobbers the
  // seeded values back to empty on an untouched form.
  const seedOnOpen = useEffectEvent(() => {
    const h = defaultHead ?? currentName ?? names[0] ?? "";
    const fallbackBase =
      defaultBranch.data && defaultBranch.data !== h
        ? defaultBranch.data
        : (names.find((n) => n !== h) ?? "");
    form.reset(
      {
        head: h,
        base: defaultBase ?? fallbackBase,
        title: "",
        body: "",
        draft: false,
      },
      { keepDefaultValues: true },
    );
  });
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  // Live head/base drive the "N commits" hint, AI generation, and submit gate.
  const head = useSelector(form.store, (s) => s.values.head);
  const base = useSelector(form.store, (s) => s.values.base);
  const comparison = useCompareBranches(repoPath, base || null, head || null);
  const ahead = comparison.data?.ahead ?? [];
  const sameBranch = base === head;
  const nothingToMerge = sameBranch || ahead.length === 0;

  const items = Object.fromEntries(names.map((n) => [n, n]));

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
              Pushes <span className="font-mono">{head || "…"}</span> and opens
              a PR into <span className="font-mono">{base || "…"}</span> on
              GitHub.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <form.AppField name="head">
                {(field) => <field.SelectField label="Merge" items={items} />}
              </form.AppField>
            </div>
            <span className="pb-2 text-xs text-muted-foreground">into</span>
            <div className="flex-1">
              <form.AppField name="base">
                {(field) => <field.SelectField label="Base" items={items} />}
              </form.AppField>
            </div>
          </div>
          {sameBranch ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Pick two different branches.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {ahead.length} commit{ahead.length === 1 ? "" : "s"} to merge.
            </p>
          )}

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
                rows={7}
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
                      disabled={nothingToMerge}
                      onClick={() =>
                        generate(
                          base,
                          head,
                          ahead.map((c) => c.subject),
                          (d) => {
                            form.setFieldValue("title", d.title);
                            form.setFieldValue("body", d.body);
                          },
                        )
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
                  <form.SubmitButton disabled={generating || nothingToMerge}>
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
