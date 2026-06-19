import {
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
} from "@phosphor-icons/react";
import { useIssueDevelopment } from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

/** Icon + tone for a linked PR, so state isn't conveyed by color alone. */
function prPresentation(state: string): {
  Icon: typeof GitPullRequestIcon;
  tone: string;
} {
  if (state === "MERGED") {
    return {
      Icon: GitMergeIcon,
      tone: "text-violet-600 dark:text-violet-400",
    };
  }
  if (state === "CLOSED") {
    return {
      Icon: GitPullRequestIcon,
      tone: "text-red-600 dark:text-red-400",
    };
  }
  return {
    Icon: GitPullRequestIcon,
    tone: "text-green-600 dark:text-green-400",
  };
}

/**
 * GitHub's issue "Development" section: the PRs that close/reference the issue
 * and the branches linked to it. Read-only; clicking a PR opens it in the Pulls
 * tab. Hidden when nothing is linked. Loads independently of the conversation.
 */
export function IssueDevelopment({
  repoPath,
  number,
}: {
  repoPath: string;
  number: number;
}) {
  const dev = useIssueDevelopment(repoPath, number);
  const selectPr = useUiStore((s) => s.selectPr);
  const setRepoTab = useUiStore((s) => s.setRepoTab);

  const prs = dev.data?.prs ?? [];
  const branches = dev.data?.branches ?? [];
  if (prs.length === 0 && branches.length === 0) return null;

  function openPr(n: number) {
    selectPr({ kind: "remote", id: String(n) });
    setRepoTab("pulls");
  }

  return (
    <div className="space-y-1.5 border-b py-3">
      <p className="text-xs font-medium">Development</p>
      {prs.map((pr) => {
        const { Icon, tone } = prPresentation(pr.state);
        return (
          <button
            key={pr.number}
            type="button"
            onClick={() => openPr(pr.number)}
            className="flex w-full items-center gap-1.5 text-left text-xs hover:underline"
            title={`#${pr.number} ${pr.title}`}
          >
            <Icon className={cn("size-3.5 shrink-0", tone)} />
            <span className="text-muted-foreground">#{pr.number}</span>
            <span className="min-w-0 flex-1 truncate">{pr.title}</span>
          </button>
        );
      })}
      {branches.map((b) => (
        <div
          key={b}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <GitBranchIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono">{b}</span>
        </div>
      ))}
    </div>
  );
}
