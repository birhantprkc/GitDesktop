import { FolderOpenIcon, GearIcon, GitBranchIcon } from "@phosphor-icons/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { validateRepo } from "@/lib/git/api";
import { useAddRecentRepo } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { errorMessage } from "@/lib/tauri/invoke";
import { CloneRepoDialog } from "./CloneRepoDialog";
import { RecentRepoList } from "./RecentRepoList";

export function WelcomeScreen() {
  const openRepo = useUiStore((s) => s.openRepo);
  const openSettings = useUiStore((s) => s.openSettings);
  const addRecent = useAddRecentRepo();
  const [cloneOpen, setCloneOpen] = useState(false);

  async function pickAndOpen() {
    const path = await openDialog({
      directory: true,
      title: "Open repository",
    });
    if (!path) return;
    try {
      const info = await validateRepo(path);
      addRecent.mutate({ path: info.root, name: info.name });
      openRepo(info);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <GitBranchIcon className="size-5" />
          <span className="text-sm font-medium">GitDesktop</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Settings"
          onClick={openSettings}
        >
          <GearIcon />
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 p-8">
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              Open a local repository or clone one from a URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button onClick={pickAndOpen}>
              <FolderOpenIcon data-icon="inline-start" />
              Open repository
            </Button>
            <Button variant="outline" onClick={() => setCloneOpen(true)}>
              Clone repository
            </Button>
          </CardContent>
        </Card>

        <RecentRepoList />
      </main>

      <CloneRepoDialog open={cloneOpen} onOpenChange={setCloneOpen} />
    </div>
  );
}
