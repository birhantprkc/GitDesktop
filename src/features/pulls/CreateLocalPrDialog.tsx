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
import {
  useBranches,
  useCompareBranches,
  useDefaultBranch,
  useRepoStatus,
} from "@/lib/git/queries";
import { useCreateLocalPr } from "@/lib/pulls/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { useGeneratePrDescription } from "./useGeneratePrDescription";

export function CreateLocalPrDialog({
  repoPath,
  defaultBase,
  defaultHead,
  open,
  onOpenChange,
}: {
  repoPath: string;
  defaultBase?: string;
  defaultHead?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useRepoStatus(repoPath);
  const branches = useBranches(repoPath);
  const defaultBranch = useDefaultBranch(repoPath);
  const createPr = useCreateLocalPr(repoPath);
  const { generate, cancel, generating } = useGeneratePrDescription(repoPath);
  const selectPr = useUiStore((s) => s.selectPr);
  const setRepoTab = useUiStore((s) => s.setRepoTab);

  const currentName = status.data?.branch?.name ?? null;
  const names = (branches.data ?? []).map((b) => b.name);

  const form = useAppForm({
    defaultValues: { head: "", base: "", title: "", body: "" },
    validators: {
      // Same branch on both sides proposes nothing — gate the submit.
      onChange: ({ value }) =>
        value.head === value.base ? "Pick two different branches." : undefined,
    },
    onSubmit: async ({ value }) => {
      try {
        const pr = await createPr.mutateAsync({
          title: value.title.trim(),
          body: value.body,
          base: value.base,
          head: value.head,
        });
        toast.success(`Created local PR: ${pr.title}`);
        setRepoTab("pulls");
        selectPr({ kind: "local", id: pr.id });
        onOpenChange(false);
      } catch (e) {
        toastError(e);
      }
    },
  });

  // keepDefaultValues: otherwise the per-render options sync clobbers the
  // seeded head/base back to empty (untouched form).
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
      },
      { keepDefaultValues: true },
    );
  });
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  // Live head/base drive the "N commits to merge" hint and AI generation.
  const head = useSelector(form.store, (s) => s.values.head);
  const base = useSelector(form.store, (s) => s.values.base);
  const comparison = useCompareBranches(repoPath, base || null, head || null);
  const ahead = comparison.data?.ahead ?? [];
  const sameBranch = base === head;

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
            <DialogTitle>New local pull request</DialogTitle>
            <DialogDescription>
              Propose merging one branch into another and review it locally — no
              GitHub involved. Merge it later with a{" "}
              <span className="font-mono">--no-ff</span> commit.
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
                      disabled={sameBranch || ahead.length === 0}
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
                Create local PR
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
