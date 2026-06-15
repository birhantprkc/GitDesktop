import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { matchesGlob } from "@/lib/branch-rules/match";
import {
  useBranchRules,
  useSaveBranchRules,
  useSaveSharedBranchRules,
  useSharedBranchRules,
} from "@/lib/branch-rules/queries";
import {
  ALL_MERGE_METHODS,
  type BranchRulesConfig,
  EMPTY_BRANCH_RULES,
  MERGE_METHOD_LABEL,
  type MergeMethod,
} from "@/lib/branch-rules/types";
import { toastError } from "@/lib/toast";

export function BranchRulesDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Which set of rules we're editing: the user's personal (app-data) rules or
  // the repo's shared, committed `.gitdesktop/branch-rules.json`. Both are
  // always enforced (merged) — this only chooses what this dialog edits.
  const [scope, setScope] = useState<"personal" | "shared">("personal");
  const personal = useBranchRules(repoPath);
  const shared = useSharedBranchRules(repoPath);
  const savePersonal = useSaveBranchRules(repoPath);
  const saveShared = useSaveSharedBranchRules(repoPath);
  const [draft, setDraft] = useState<BranchRulesConfig>(EMPTY_BRANCH_RULES);
  const [testName, setTestName] = useState("");

  const active = scope === "shared" ? shared : personal;
  const saving = scope === "shared" ? saveShared : savePersonal;

  // Seed the editable draft from the active scope when the dialog opens or the
  // scope changes (switching scopes discards any unsaved edits in the other).
  const seededScope = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      seededScope.current = null;
      return;
    }
    if (seededScope.current !== scope && active.data) {
      seededScope.current = scope;
      setDraft(active.data);
    }
  }, [open, scope, active.data]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(active.data ?? null);

  function setNaming(patch: Partial<BranchRulesConfig["naming"]>) {
    setDraft((d) => ({ ...d, naming: { ...d.naming, ...patch } }));
  }

  function addProtection() {
    setDraft((d) => ({
      ...d,
      protections: [
        ...d.protections,
        {
          id: crypto.randomUUID(),
          pattern: "",
          blockDeletion: true,
          blockForcePush: true,
          requirePr: false,
          allowedMergeMethods: [...ALL_MERGE_METHODS],
        },
      ],
    }));
  }

  function toggleMergeMethod(id: string, method: MergeMethod, on: boolean) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.map((p) =>
        p.id === id
          ? {
              ...p,
              allowedMergeMethods: on
                ? ALL_MERGE_METHODS.filter(
                    (m) => p.allowedMergeMethods.includes(m) || m === method,
                  )
                : p.allowedMergeMethods.filter((m) => m !== method),
            }
          : p,
      ),
    }));
  }

  function updateProtection(
    id: string,
    patch: Partial<BranchRulesConfig["protections"][number]>,
  ) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
  }

  function removeProtection(id: string) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.filter((p) => p.id !== id),
    }));
  }

  function doSave() {
    saving.mutate(draft, {
      onSuccess: () => {
        toast.success(
          scope === "shared"
            ? "Saved to .gitdesktop/branch-rules.json — commit it to share with your team"
            : "Branch rules saved",
        );
        onOpenChange(false);
      },
      onError: toastError,
    });
  }

  const namePattern = draft.naming.pattern.trim();
  const testMatches = namePattern !== "" && matchesGlob(namePattern, testName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Branch rules</DialogTitle>
          <DialogDescription>
            Local guardrails GitDesktop enforces in this repository. They help
            prevent accidents on any repo; GitHub's own protection still applies
            on push. Patterns are globs — <span className="font-mono">*</span>{" "}
            within a segment, <span className="font-mono">**</span> across{" "}
            <span className="font-mono">/</span>,{" "}
            <span className="font-mono">{"{a,b}"}</span> alternation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex gap-1">
            <Button
              variant={scope === "personal" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setScope("personal")}
            >
              Personal
            </Button>
            <Button
              variant={scope === "shared" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setScope("shared")}
            >
              Shared with repository
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {scope === "shared" ? (
              <>
                Saved to{" "}
                <span className="font-mono">.gitdesktop/branch-rules.json</span>{" "}
                and committed — everyone with the repo gets them. Combines with
                each person's personal rules.
              </>
            ) : (
              "Stored on this machine only. Your personal rules combine with the repo's shared rules."
            )}
          </p>
        </div>

        {active.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-xs font-medium">New branch names</h3>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={draft.naming.enabled}
                  onCheckedChange={(c) => setNaming({ enabled: c === true })}
                />
                Require new branches to match a pattern
              </label>
              {draft.naming.enabled && (
                <div className="space-y-2 pl-6">
                  <div className="space-y-1">
                    <Label className="text-xs">Pattern</Label>
                    <Input
                      value={draft.naming.pattern}
                      onChange={(e) => setNaming({ pattern: e.target.value })}
                      placeholder="{feature,fix,chore}/*"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Hint (shown when rejected)
                    </Label>
                    <Input
                      value={draft.naming.hint}
                      onChange={(e) => setNaming({ hint: e.target.value })}
                      placeholder="feature/login, fix/crash"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Try a name</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={testName}
                        onChange={(e) => setTestName(e.target.value)}
                        placeholder="feature/login"
                        className="font-mono"
                      />
                      {testName.trim() !== "" && (
                        <span
                          className={
                            testMatches
                              ? "shrink-0 text-xs text-green-600 dark:text-green-400"
                              : "shrink-0 text-xs text-destructive"
                          }
                        >
                          {testMatches ? "matches" : "rejected"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium">Protected branches</h3>
                <Button variant="outline" size="xs" onClick={addProtection}>
                  <PlusIcon data-icon="inline-start" />
                  Add
                </Button>
              </div>
              {draft.protections.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No protected branches. Add one to guard branches that match a
                  pattern (e.g. <span className="font-mono">main</span> or{" "}
                  <span className="font-mono">release/*</span>) against
                  deletion, force-pushes, and unwanted merge types.
                </p>
              ) : (
                <div className="space-y-3">
                  {draft.protections.map((p) => (
                    <div
                      key={p.id}
                      className="space-y-2 rounded-md border p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          value={p.pattern}
                          onChange={(e) =>
                            updateProtection(p.id, { pattern: e.target.value })
                          }
                          placeholder="main"
                          className="font-mono"
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Remove"
                          onClick={() => removeProtection(p.id)}
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                          <Checkbox
                            checked={p.blockDeletion}
                            onCheckedChange={(c) =>
                              updateProtection(p.id, {
                                blockDeletion: c === true,
                              })
                            }
                          />
                          Block deletion
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                          <Checkbox
                            checked={p.blockForcePush}
                            onCheckedChange={(c) =>
                              updateProtection(p.id, {
                                blockForcePush: c === true,
                              })
                            }
                          />
                          Block force-push
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                          <Checkbox
                            checked={p.requirePr}
                            onCheckedChange={(c) =>
                              updateProtection(p.id, { requirePr: c === true })
                            }
                          />
                          Require pull request
                        </label>
                      </div>
                      <div>
                        <span className="text-[11px] text-muted-foreground">
                          Allowed merges into this branch
                          {p.requirePr ? " (via pull request)" : ""}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
                          {ALL_MERGE_METHODS.map((m) => (
                            <label
                              key={m}
                              className="flex cursor-pointer items-center gap-1.5 text-xs"
                            >
                              <Checkbox
                                checked={p.allowedMergeMethods.includes(m)}
                                onCheckedChange={(c) =>
                                  toggleMergeMethod(p.id, m, c === true)
                                }
                              />
                              {MERGE_METHOD_LABEL[m]}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={doSave} disabled={!dirty || saving.isPending}>
            {scope === "shared" ? "Save to repository" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
