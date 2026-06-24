import { WrenchIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { buildSolveIssuePrompt } from "@/lib/ai/prompt";
import { useAiEnabled } from "@/lib/settings/queries";
import { handoffToAgent } from "./handoff";

/**
 * "Solve with agent" action for an issue: hands the issue to a new write-capable
 * agent session to investigate and resolve it. Distinct from a plan's "Implement
 * now" — an issue is a problem to diagnose and fix, not a vetted spec — so it gets
 * a solve/debug framing (see {@link buildSolveIssuePrompt}). It doesn't spend
 * tokens immediately: it seeds the "Delegate a task" composer (the human gate)
 * where the user picks the agent/model/effort and confirms. AI-gated.
 */
export function SolveIssueButton({
  repoPath,
  title,
  body,
}: {
  repoPath: string;
  title: string;
  body: string;
}) {
  const aiEnabled = useAiEnabled();
  if (!aiEnabled) return null;

  return (
    <Button
      variant="outline"
      size="xs"
      title="Hand this issue to a write-capable agent to investigate and fix"
      onClick={() =>
        handoffToAgent(repoPath, buildSolveIssuePrompt({ title, body }))
      }
    >
      <WrenchIcon data-icon="inline-start" />
      Solve with agent
    </Button>
  );
}
