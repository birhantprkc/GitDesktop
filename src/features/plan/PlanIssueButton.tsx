import { SparkleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useAiEnabled } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { usePlanStore } from "./store";

/**
 * "Plan" action for an issue detail view: opens the read-only plan composer in
 * the Agent surface, seeded with this issue, so a Tier-2 agent can explore the
 * repo and enrich it into an agent-ready spec. AI-gated (hidden when AI is off).
 */
export function PlanIssueButton({
  repoPath,
  title,
  body,
}: {
  repoPath: string;
  title: string;
  body: string;
}) {
  const aiEnabled = useAiEnabled();
  const open = usePlanStore((s) => s.open);
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  if (!aiEnabled) return null;

  return (
    <Button
      variant="outline"
      size="xs"
      title="Plan an implementation for this issue with a read-only agent"
      onClick={() => {
        open(repoPath, { issueTitle: title, issueBody: body });
        setRepoTab("agent");
      }}
    >
      <SparkleIcon data-icon="inline-start" />
      Plan
    </Button>
  );
}
