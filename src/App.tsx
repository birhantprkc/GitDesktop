import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { AutomationResultDialog } from "@/features/automations/AutomationResultDialog";
import { HelpScreen } from "@/features/help/HelpScreen";
import { RepositoryView } from "@/features/repository/RepositoryView";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { CommandPalette } from "@/features/shortcuts/CommandPalette";
import { ShortcutsDialog } from "@/features/shortcuts/ShortcutsDialog";
import { UpdateChecker } from "@/features/updates/UpdateChecker";
import { GitMissingScreen } from "@/features/welcome/GitMissingScreen";
import { WelcomeScreen } from "@/features/welcome/WelcomeScreen";
import { useGitInstalled } from "@/lib/git/queries";
import { useHotkeyAction, useHotkeysListener } from "@/lib/hotkeys/hotkeys";
import { useUiStore } from "@/lib/stores/ui";

function App() {
  const view = useUiStore((s) => s.view);
  const openSettings = useUiStore((s) => s.openSettings);
  const openHelp = useUiStore((s) => s.openHelp);
  const gitInstalled = useGitInstalled();
  const queryClient = useQueryClient();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The app-wide hotkey dispatcher plus the always-available actions.
  useHotkeysListener();
  useHotkeyAction("open-settings", openSettings);
  useHotkeyAction("show-help", openHelp);
  useHotkeyAction("show-shortcuts", () => setShortcutsOpen(true));
  useHotkeyAction("command-palette", () => setPaletteOpen(true));

  // The webview stays "visible" when the window loses focus, so TanStack's
  // own focus refetch never fires in Tauri; bridge the native focus event.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(
      ({ payload: focused }) => {
        if (focused) {
          queryClient.invalidateQueries({ queryKey: ["repo"] });
        }
      },
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, [queryClient]);

  if (gitInstalled.isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (gitInstalled.isError) {
    return <GitMissingScreen onRetry={() => gitInstalled.refetch()} />;
  }

  return (
    <>
      {view === "welcome" && <WelcomeScreen />}
      {view === "repo" && <RepositoryView />}
      {view === "settings" && <SettingsScreen />}
      {view === "help" && <HelpScreen />}
      <AutomationResultDialog />
      <UpdateChecker />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}

export default App;
