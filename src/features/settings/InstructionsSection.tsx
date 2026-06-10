import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AppSettings } from "@/lib/settings/api";
import { useSaveSettings } from "@/lib/settings/queries";

export function InstructionsSection({ settings }: { settings: AppSettings }) {
  const saveSettings = useSaveSettings();
  const [instructionsDraft, setInstructionsDraft] = useState(
    settings.globalInstructions,
  );
  const [ignoreDraft, setIgnoreDraft] = useState(settings.aiIgnorePatterns);

  useEffect(() => {
    setInstructionsDraft(settings.globalInstructions);
  }, [settings.globalInstructions]);
  useEffect(() => {
    setIgnoreDraft(settings.aiIgnorePatterns);
  }, [settings.aiIgnorePatterns]);

  const dirty =
    instructionsDraft !== settings.globalInstructions ||
    ignoreDraft !== settings.aiIgnorePatterns;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">Commit message generation</h2>
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
          value={instructionsDraft}
          onChange={(e) => setInstructionsDraft(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ai-ignore">Excluded files</Label>
        <Textarea
          id="ai-ignore"
          rows={4}
          className="max-h-48 font-mono"
          placeholder={".agents\n*.lock\ndocs/generated"}
          value={ignoreDraft}
          onChange={(e) => setIgnoreDraft(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          gitignore-style patterns, one per line. Matching files stay staged and
          committed as usual, but their diffs are left out of what the AI sees,
          so noisy folders don't dominate the message.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!dirty || saveSettings.isPending}
          onClick={() =>
            saveSettings.mutate(
              {
                ...settings,
                globalInstructions: instructionsDraft,
                aiIgnorePatterns: ignoreDraft,
              },
              { onSuccess: () => toast.success("Saved") },
            )
          }
        >
          Save
        </Button>
        {dirty && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
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
