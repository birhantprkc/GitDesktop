import { useState } from "react";
import {
  RemoveRepoDialog,
  RepoAliasDialog,
} from "@/features/repository/RepoDialogs";
import { RepoList } from "@/features/repository/RepoList";
import type { RecentRepo } from "@/lib/settings/api";
import { useSettings } from "@/lib/settings/queries";

export function RecentRepoList() {
  const settings = useSettings();
  const recents = settings.data?.recentRepos ?? [];
  const [aliasTarget, setAliasTarget] = useState<RecentRepo | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RecentRepo | null>(null);

  return (
    <div className="min-w-0 space-y-2">
      <h2 className="px-1 font-heading text-sm font-medium">Repositories</h2>
      {recents.length === 0 ? (
        <div className="border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
          Repositories you open will be listed here — open, clone, or create one
          above to get started.
        </div>
      ) : (
        <div className="overflow-hidden rounded-none border">
          <RepoList
            onAliasRepo={setAliasTarget}
            onRemoveRepo={setRemoveTarget}
          />
        </div>
      )}
      <RepoAliasDialog
        key={aliasTarget?.path ?? "none"}
        repo={aliasTarget}
        onClose={() => setAliasTarget(null)}
      />
      <RemoveRepoDialog
        repo={removeTarget}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}
