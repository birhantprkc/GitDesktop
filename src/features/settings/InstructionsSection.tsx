import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SectionProps } from "./SettingsScreen";

export function InstructionsSection({ draft, update }: SectionProps) {
  return (
    <section className="space-y-4 border-t pt-4">
      <div>
        <h2 className="text-sm font-medium">Instructions</h2>
        <p className="text-xs text-muted-foreground">
          Applied to every AI generation. Use instructions for team conventions,
          e.g. "Follow Conventional Commits" or "Explain intent, not
          implementation."
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="global-instructions">Global instructions</Label>
        <Textarea
          id="global-instructions"
          rows={6}
          className="max-h-64"
          placeholder={
            "You must follow Conventional Commits.\nAlways explain the business context in the body."
          }
          value={draft.globalInstructions}
          onChange={(e) => update({ globalInstructions: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ai-ignore">Excluded files</Label>
        <Textarea
          id="ai-ignore"
          rows={4}
          className="max-h-48 font-mono"
          placeholder={".agents\n*.lock\ndocs/generated"}
          value={draft.aiIgnorePatterns}
          onChange={(e) => update({ aiIgnorePatterns: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          gitignore-style patterns, one per line. Matching files stay staged and
          committed as usual, but their diffs are left out of what the AI sees,
          so noisy folders don't dominate the message.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Per-repository overrides: create{" "}
        <code className="rounded bg-muted px-1 py-0.5">
          .gitdesktop/instructions.md
        </code>{" "}
        for project-specific rules and{" "}
        <code className="rounded bg-muted px-1 py-0.5">
          .gitdesktop/aiignore
        </code>{" "}
        for project-specific exclusions. Both combine with the global settings
        above.
      </p>
    </section>
  );
}
