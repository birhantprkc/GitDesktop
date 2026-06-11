import { RepoList } from "@/features/repository/RepoList";
import { useSettings } from "@/lib/settings/queries";

export function RecentRepoList() {
  const settings = useSettings();
  const recents = settings.data?.recentRepos ?? [];

  return (
    <div className="space-y-2">
      <h2 className="px-1 text-xs font-medium text-muted-foreground">
        Repositories
      </h2>
      {recents.length === 0 ? (
        <div className="border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
          Repositories you open will be listed here — open, clone, or create one
          above to get started.
        </div>
      ) : (
        <div className="rounded-none border">
          <RepoList />
        </div>
      )}
    </div>
  );
}
