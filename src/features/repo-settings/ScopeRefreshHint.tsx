import { CopyIcon } from "@phosphor-icons/react";
import { copyText } from "@/lib/clipboard";
import { useGhScopes } from "@/lib/git/queries";

/**
 * Shows a copyable `gh auth refresh -s <scope>` when the active gh token is a
 * classic OAuth/PAT token missing `scope`. Renders nothing when the scope is
 * present, or for a fine-grained/App token (those have no readable scopes and
 * can't be refreshed this way) — so it never nags about a non-problem.
 */
export function ScopeRefreshHint({
  scope,
  action,
}: {
  scope: string;
  action: string;
}) {
  const scopes = useGhScopes();
  if (!scopes.data?.classic || scopes.data.scopes.includes(scope)) return null;
  const cmd = `gh auth refresh -h github.com -s ${scope}`;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[11px]">
      <p className="text-muted-foreground">
        {action} needs the <span className="font-mono">{scope}</span> scope,
        which your GitHub sign-in is missing. Run this, then reopen:
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono">
          {cmd}
        </code>
        <button
          type="button"
          className="shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
          title="Copy command"
          onClick={() => copyText(cmd, "Command copied")}
        >
          <CopyIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
