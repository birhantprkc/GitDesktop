import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAutomations,
  useSaveRepoAutomations,
} from "@/lib/automations/queries";
import {
  ACTION_LABELS,
  type AutomationRule,
  TRIGGER_LABELS,
} from "@/lib/automations/types";
import { toastError } from "@/lib/toast";
import { RuleList } from "./RuleList";

/**
 * This repository's automations: per-repo switches over the global rules,
 * plus rules that exist only here. Changes apply immediately.
 */
export function RepoAutomationsDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const automations = useAutomations();
  const save = useSaveRepoAutomations(repoPath);

  const repo = automations.data?.repos[repoPath];
  const disabledIds = new Set(repo?.disabledGlobalIds ?? []);
  const globalRules = (automations.data?.global ?? []).filter((r) => r.enabled);

  function toggleGlobal(ruleId: string, enabledHere: boolean) {
    const next = new Set(disabledIds);
    if (enabledHere) next.delete(ruleId);
    else next.add(ruleId);
    save.mutate(
      { disabledGlobalIds: [...next], rules: repo?.rules ?? [] },
      { onError: toastError },
    );
  }

  function setRepoRules(rules: AutomationRule[]) {
    save.mutate(
      { disabledGlobalIds: [...disabledIds], rules },
      { onError: toastError },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Repository automations</DialogTitle>
          <DialogDescription>
            What runs automatically in this repository. Global rules come from
            Settings → Automations; rules added here apply only to this
            repository.
          </DialogDescription>
        </DialogHeader>
        {automations.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-xs font-medium">Global rules</h3>
              {globalRules.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No global rules are active. Add defaults in Settings →
                  Automations.
                </p>
              ) : (
                globalRules.map((rule) => (
                  <label
                    key={rule.id}
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  >
                    <Checkbox
                      checked={!disabledIds.has(rule.id)}
                      onCheckedChange={(checked) =>
                        toggleGlobal(rule.id, checked === true)
                      }
                    />
                    <span>
                      {TRIGGER_LABELS[rule.trigger]} →{" "}
                      {ACTION_LABELS[rule.action]}
                    </span>
                  </label>
                ))
              )}
            </section>
            <section className="space-y-2">
              <h3 className="text-xs font-medium">Rules for this repository</h3>
              <RuleList
                rules={repo?.rules ?? []}
                onChange={setRepoRules}
                emptyHint="No repository-specific rules."
              />
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
