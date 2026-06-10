import { FolderIcon, XIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { validateRepo } from "@/lib/git/api";
import {
  useAddRecentRepo,
  useRemoveRecentRepo,
  useSettings,
} from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { isAppError } from "@/lib/tauri/invoke";
import { toastError } from "@/lib/toast";

export function RecentRepoList() {
  const settings = useSettings();
  const openRepo = useUiStore((s) => s.openRepo);
  const addRecent = useAddRecentRepo();
  const removeRecent = useRemoveRecentRepo();

  const recents = settings.data?.recentRepos ?? [];
  if (recents.length === 0) return null;

  async function openRecent(path: string) {
    try {
      const info = await validateRepo(path);
      addRecent.mutate({ path: info.root, name: info.name });
      openRepo(info);
    } catch (e) {
      if (isAppError(e) && e.kind === "notARepo") {
        toast.error(`${path} is no longer a git repository.`, {
          action: {
            label: "Remove",
            onClick: () => removeRecent.mutate(path),
          },
        });
      } else {
        toastError(e);
      }
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="px-1 text-xs font-medium text-muted-foreground">
        Recent repositories
      </h2>
      <ItemGroup className="rounded-none border">
        {recents.map((repo) => (
          <Item
            key={repo.path}
            size="sm"
            className="cursor-pointer hover:bg-muted"
            onClick={() => openRecent(repo.path)}
          >
            <ItemMedia>
              <FolderIcon className="size-4 text-muted-foreground" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{repo.name}</ItemTitle>
              <ItemDescription className="truncate">
                {repo.path}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${repo.name} from recent repositories`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeRecent.mutate(repo.path);
                }}
              >
                <XIcon />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}
