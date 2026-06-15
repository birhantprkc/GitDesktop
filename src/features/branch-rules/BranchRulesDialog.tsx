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
import { useBranchRules, useSaveBranchRules } from "@/lib/branch-rules/queries";
import {
  type BranchRulesConfig,
  EMPTY_BRANCH_RULES,
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
  const rules = useBranchRules(repoPath);
  const save = useSaveBranchRules(repoPath);
  const [draft, setDraft] = useState<BranchRulesConfig>(EMPTY_BRANCH_RULES);
  const [testName, setTestName] = useState("");

  // Seed the editable draft once each time the dialog opens (after data loads),
  // so reopening always starts from the saved rules.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (!seeded.current && rules.data) {
      seeded.current = true;
      setDraft(rules.data);
    }
  }, [open, rules.data]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(rules.data ?? null);

  function setNaming(patch: Partial<BranchRulesConfig["naming"]>) {
    setDraft((d) => ({ ...d, naming: { ...d.naming, ...patch } }));
  }

  function addProtection() {
    setDraft((d) => ({
      ...d,
      protections: [
        ...d.protections,
        { id: crypto.randomUUID(), pattern: "", blockDeletion: true },
      ],
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
    save.mutate(draft, {
      onSuccess: () => {
        toast.success("Branch rules saved");
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

        {rules.isPending ? (
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
                  No protected branches. Add one to block deleting branches that
                  match a pattern (e.g. <span className="font-mono">main</span>{" "}
                  or <span className="font-mono">release/*</span>).
                </p>
              ) : (
                <div className="space-y-2">
                  {draft.protections.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <Input
                        value={p.pattern}
                        onChange={(e) =>
                          updateProtection(p.id, { pattern: e.target.value })
                        }
                        placeholder="main"
                        className="font-mono"
                      />
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={p.blockDeletion}
                          onCheckedChange={(c) =>
                            updateProtection(p.id, {
                              blockDeletion: c === true,
                            })
                          }
                        />
                        No delete
                      </label>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remove"
                        onClick={() => removeProtection(p.id)}
                      >
                        <TrashIcon />
                      </Button>
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
          <Button onClick={doSave} disabled={!dirty || save.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
