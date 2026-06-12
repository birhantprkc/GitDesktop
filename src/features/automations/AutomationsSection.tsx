import { Skeleton } from "@/components/ui/skeleton";
import { useAutomations, useSaveAutomations } from "@/lib/automations/queries";
import type { AutomationRule } from "@/lib/automations/types";
import { toastError } from "@/lib/toast";
import { RuleList } from "./RuleList";

/**
 * Global automation rules — the defaults every repository starts from.
 * Saved immediately (like API keys), independent of the settings draft.
 */
export function AutomationsSection() {
  const automations = useAutomations();
  const save = useSaveAutomations();

  function setGlobal(rules: AutomationRule[]) {
    if (!automations.data) return;
    save.mutate(
      { ...automations.data, global: rules },
      { onError: toastError },
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Automations</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Run an AI action automatically when something happens. These rules
          apply to every repository; a repository can switch them off or add its
          own from its ⋯ menu. Reviews use the review model configured in the AI
          section — PR results are posted as a comment, commit results open from
          a notification.
        </p>
      </div>
      {automations.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <RuleList
          rules={automations.data?.global ?? []}
          onChange={setGlobal}
          emptyHint="No automation rules yet. Add one — e.g. run an AI review whenever a pull request is opened."
        />
      )}
    </section>
  );
}
