import { SparkleIcon } from "@phosphor-icons/react";
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
import { Spinner } from "@/components/ui/spinner";
import { branchNameError, branchNameHint } from "@/lib/branch-rules/match";
import type { BranchRulesConfig } from "@/lib/branch-rules/types";
import { required, useAppForm } from "@/lib/form";
import { useCreateBranch } from "@/lib/git/queries";
import { refNameWarning, sanitizeRefName } from "@/lib/git/ref-name";
import type { FileEntry } from "@/lib/git/types";
import { toastError } from "@/lib/toast";
import { useGenerateBranchName } from "./useGenerateBranchName";

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
  const branchNameGen = useGenerateBranchName(repoPath);

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
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createForm.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>
              Branches from{" "}
              <span className="font-mono">{createBase || "HEAD"}</span> and
              switches to it.
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
          {aiEnabled && (
            <div className="flex justify-end">
              {!aiConfigured ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  title="Connect an AI provider to generate branch names"
                  onClick={() => {
                    onOpenChange(false);
                    onOpenSettings("ai");
                  }}
                >
                  <SparkleIcon data-icon="inline-start" />
                  Set up AI to name branches
                </Button>
              ) : branchNameGen.generating ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={branchNameGen.cancel}
                >
                  <Spinner data-icon="inline-start" />
                  Generating…
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  disabled={!hasChanges || !headExists}
                  title={
                    !headExists
                      ? "Make your first commit before branching from changes"
                      : !hasChanges
                        ? "No in-progress changes — make some edits to name a branch after them"
                        : "Suggest a name from your in-progress changes"
                  }
                  onClick={() =>
                    branchNameGen.generate({
                      entries,
                      recentBranches: allBranchNames.slice(0, 20),
                      onName: (name) => createForm.setFieldValue("name", name),
                    })
                  }
                >
                  <SparkleIcon data-icon="inline-start" />
                  Generate from changes
                </Button>
              )}
            </div>
          )}
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
