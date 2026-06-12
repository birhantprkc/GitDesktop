import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReviewMode } from "@/lib/ai/types";
import {
  ACTION_LABELS,
  type AutomationRule,
  type AutomationTrigger,
  TRIGGER_LABELS,
} from "@/lib/automations/types";

const TRIGGER_IDS = Object.keys(TRIGGER_LABELS) as AutomationTrigger[];
const ACTION_IDS = Object.keys(ACTION_LABELS) as ReviewMode[];

/**
 * Editable list of automation rules (trigger → action), applied
 * immediately via onChange — no draft step, like the API-key form.
 */
export function RuleList({
  rules,
  onChange,
  emptyHint,
}: {
  rules: AutomationRule[];
  onChange: (rules: AutomationRule[]) => void;
  emptyHint: string;
}) {
  function patch(id: string, change: Partial<AutomationRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  return (
    <div className="space-y-2">
      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-2">
          <label
            className="flex cursor-pointer items-center"
            title={rule.enabled ? "Rule is active" : "Rule is paused"}
          >
            <Checkbox
              checked={rule.enabled}
              onCheckedChange={(checked) =>
                patch(rule.id, { enabled: checked === true })
              }
            />
          </label>
          <Select
            items={TRIGGER_LABELS}
            value={rule.trigger}
            onValueChange={(v) =>
              v && patch(rule.id, { trigger: v as AutomationTrigger })
            }
          >
            <SelectTrigger className="flex-1" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {TRIGGER_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={ACTION_LABELS}
            value={rule.action}
            onValueChange={(v) =>
              v && patch(rule.id, { action: v as ReviewMode })
            }
          >
            <SelectTrigger className="flex-1" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {ACTION_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove rule"
            onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
          >
            <TrashIcon />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...rules,
            {
              id: crypto.randomUUID(),
              trigger: "pr-open",
              action: "general",
              enabled: true,
            },
          ])
        }
      >
        <PlusIcon data-icon="inline-start" />
        Add rule
      </Button>
    </div>
  );
}
