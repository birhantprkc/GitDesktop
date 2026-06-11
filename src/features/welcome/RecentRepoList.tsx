import { RepoList } from "@/features/repository/RepoList";
import { useSettings } from "@/lib/settings/queries";

export function RecentRepoList() {
  const settings = useSettings();
  const recents = settings.data?.recentRepos ?? [];
  if (recents.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="px-1 text-xs font-medium text-muted-foreground">
        Repositories
      </h2>
      <div className="rounded-none border">
        <RepoList />
      </div>
    </div>
  );
}
