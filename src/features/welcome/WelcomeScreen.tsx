import {
  BookOpenIcon,
  FolderOpenIcon,
  GearIcon,
  QuestionIcon,
} from "@phosphor-icons/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { validateRepo } from "@/lib/git/api";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import {
  useAddRecentRepo,
  useSaveSettings,
  useSettings,
} from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { CloneRepoDialog } from "./CloneRepoDialog";
import { CreateRepoDialog } from "./CreateRepoDialog";
import { RecentRepoList } from "./RecentRepoList";

export function WelcomeScreen() {
  const openRepo = useUiStore((s) => s.openRepo);
  const openSettings = useUiStore((s) => s.openSettings);
  const openHelp = useUiStore((s) => s.openHelp);
  const addRecent = useAddRecentRepo();
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const [cloneOpen, setCloneOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  function dismissNudge() {
    if (settings.data) {
      saveSettings.mutate({ ...settings.data, seenGuideNudge: true });
    }
  }
  function openGuide() {
    dismissNudge();
    openHelp();
  }

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
      toastError(e);
    }
  }

  useHotkeyAction("add-local-repository", pickAndOpen);
  useHotkeyAction("clone-repository", () => setCloneOpen(true));
  useHotkeyAction("new-repository", () => setCreateOpen(true));

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <BrandMark className="size-5" />
          <span className="text-sm font-medium">GitDesktop</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="User guide"
            title="User guide (F1)"
            onClick={openHelp}
          >
            <QuestionIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            onClick={() => openSettings()}
          >
            <GearIcon />
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 p-8">
        {settings.data && !settings.data.seenGuideNudge && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpenIcon className="size-4 text-primary" />
                New to GitDesktop?
              </CardTitle>
              <CardDescription>
                The built-in guide walks through everything the app can do —
                repositories, branches, pull requests, GitHub Actions, AI, and
                more.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" onClick={openGuide}>
                <BookOpenIcon data-icon="inline-start" />
                Open the guide
              </Button>
              <Button variant="ghost" size="sm" onClick={dismissNudge}>
                Maybe later
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              Open a local repository, clone one from a URL, or create a new
              one. You can also drag a repo folder anywhere onto the window.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={pickAndOpen}>
              <FolderOpenIcon data-icon="inline-start" />
              Open repository
            </Button>
            <Button variant="outline" onClick={() => setCloneOpen(true)}>
              Clone repository
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              Create repository
            </Button>
          </CardContent>
        </Card>

        <RecentRepoList />
      </main>

      <CloneRepoDialog open={cloneOpen} onOpenChange={setCloneOpen} />
      <CreateRepoDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
