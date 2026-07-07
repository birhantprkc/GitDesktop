import { SparkleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { FileEntry } from "@/lib/git/types";
import { useGenerateBranchName } from "./useGenerateBranchName";

/**
 * The "✧ Generate from changes" affordance shared by the create- and
 * rename-branch dialogs: suggests a branch name from the working-tree changes,
 * or points the user at AI setup when no provider is connected. Renders nothing
 * when AI is disabled. Owns its own generation stream, so each dialog only says
 * where the name lands (`onName`) and how to reach AI settings (`onSetupAi`).
 */
export function GenerateBranchNameButton({
  repoPath,
  aiEnabled,
  aiConfigured,
  hasChanges,
  headExists,
  entries,
  recentBranches,
  onName,
  onSetupAi,
}: {
  repoPath: string;
  aiEnabled: boolean;
  aiConfigured: boolean;
  hasChanges: boolean;
  headExists: boolean;
  entries: FileEntry[];
  /** Existing branch names, used as a naming-convention reference (capped). */
  recentBranches: string[];
  onName: (name: string) => void;
  /** Close the host dialog and open AI settings. */
  onSetupAi: () => void;
}) {
  const branchNameGen = useGenerateBranchName(repoPath);
  if (!aiEnabled) return null;
  return (
    <div className="flex justify-end">
      {!aiConfigured ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          title="Connect an AI provider to generate branch names"
          onClick={onSetupAi}
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
              recentBranches: recentBranches.slice(0, 20),
              onName,
            })
          }
        >
          <SparkleIcon data-icon="inline-start" />
          Generate from changes
        </Button>
      )}
    </div>
  );
}
