import { useSelector } from "@tanstack/react-store";
import { useEffect, useEffectEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { branchNameError, branchNameHint } from "@/lib/branch-rules/match";
import type { BranchRulesConfig } from "@/lib/branch-rules/types";
import { required, useAppForm } from "@/lib/form";
import { useCreateBranch } from "@/lib/git/queries";
import { refNameWarning, sanitizeRefName } from "@/lib/git/ref-name";
import type { FileEntry } from "@/lib/git/types";
import { toastError } from "@/lib/toast";
import { GenerateBranchNameButton } from "./GenerateBranchNameButton";

/**
 * Create-branch dialog: names a new branch (with optional AI generation from
 * the working-tree changes), picks its base, and switches to it. Owns its own
 * form + the create mutation + the branch-name generator — the switcher only
 * decides whether it's open and hands down the data it renders. Seeds the base
 * on open so it reflects the branch you were on when you triggered it.
 */
export function CreateBranchDialog({
  repoPath,
  open,
  onOpenChange,
  rulesConfig,
  aiEnabled,
  aiConfigured,
  hasChanges,
  headExists,
  entries,
  allBranchNames,
  baseOptions,
  currentName,
  defaultName,
  onOpenSettings,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rulesConfig: BranchRulesConfig;
  aiEnabled: boolean;
  aiConfigured: boolean;
  hasChanges: boolean;
  headExists: boolean;
  entries: FileEntry[];
  allBranchNames: string[];
  baseOptions: string[];
  currentName: string | null;
  defaultName: string | null;
  onOpenSettings: (section: "ai") => void;
}) {
  const createBranch = useCreateBranch(repoPath);

  const createForm = useAppForm({
    defaultValues: { name: "", base: "" },
    onSubmit: async ({ value }) => {
      // Hoisted out of the try: a `||` value block inside try/catch bails the
      // whole component out of the React Compiler.
      const startPoint = value.base || undefined;
      try {
        await createBranch.mutateAsync({
          name: sanitizeRefName(value.name),
          checkout: true,
          startPoint,
        });
        onOpenChange(false);
      } catch (e) {
        toastError(e);
      }
    },
  });
  // Drives the "Branches from …" copy in the dialog description.
  const createBase = useSelector(createForm.store, (s) => s.values.base);

  // NOTE: seeding resets must pass keepDefaultValues — otherwise reset()
  // rewrites the form's defaultValues, and react-form's per-render options
  // sync sees "different defaults + untouched form" and clobbers the seeded
  // values right back on the next render.
  const seedOnOpen = useEffectEvent(() => {
    createForm.reset(
      { name: "", base: currentName ?? defaultName ?? "" },
      { keepDefaultValues: true },
    );
  });
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          // min-w-0: DialogContent is display:grid, so this grid item must be
          // allowed to shrink below its content — otherwise a long base branch
          // name (e.g. feature/ollama-cloud-provider-custom-endpoints) pushes
          // the form past the dialog's max-width and the text overflows.
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createForm.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>
              Branches from{" "}
              <span className="font-mono wrap-break-word">
                {createBase || "HEAD"}
              </span>{" "}
              and switches to it.
            </DialogDescription>
          </DialogHeader>
          <createForm.AppField
            name="name"
            validators={{
              onChange: ({ value }) =>
                required(value) ??
                branchNameError(rulesConfig, sanitizeRefName(value)) ??
                undefined,
            }}
          >
            {(field) => (
              <field.TextField
                label="Branch name"
                placeholder="feature/my-change"
                // Surface the branch-rules naming requirement (so a disabled
                // Create button is explained), else the sanitization hint.
                warning={(value) =>
                  branchNameHint(rulesConfig, sanitizeRefName(value)) ??
                  refNameWarning(value)
                }
              />
            )}
          </createForm.AppField>
          <GenerateBranchNameButton
            repoPath={repoPath}
            aiEnabled={aiEnabled}
            aiConfigured={aiConfigured}
            hasChanges={hasChanges}
            headExists={headExists}
            entries={entries}
            recentBranches={allBranchNames}
            onName={(name) => createForm.setFieldValue("name", name)}
            onSetupAi={() => {
              onOpenChange(false);
              onOpenSettings("ai");
            }}
          />
          {baseOptions.length > 0 && (
            <createForm.AppField name="base">
              {(field) => (
                <field.SelectField
                  label="Base it on"
                  items={Object.fromEntries(
                    baseOptions.map((b) => [
                      b,
                      `${b}${b === currentName ? " (current)" : ""}${
                        b === defaultName ? " (default)" : ""
                      }`,
                    ]),
                  )}
                />
              )}
            </createForm.AppField>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <createForm.AppForm>
              <createForm.SubmitButton>Create branch</createForm.SubmitButton>
            </createForm.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
