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
import { WhatsNew } from "@/features/updates/WhatsNew";
import { GitMissingScreen } from "@/features/welcome/GitMissingScreen";
import { useRepoDrop } from "@/features/welcome/useRepoDrop";
import { WelcomeScreen } from "@/features/welcome/WelcomeScreen";
import { useGitInstalled } from "@/lib/git/queries";
import { useHotkeyAction, useHotkeysListener } from "@/lib/hotkeys/hotkeys";
import { useUiStore } from "@/lib/stores/ui";
import { COLD_START } from "@/lib/test-mode";

function App() {
  const view = useUiStore((s) => s.view);
  const openSettings = useUiStore((s) => s.openSettings);
  const openHelp = useUiStore((s) => s.openHelp);
  const gitInstalled = useGitInstalled();
  const queryClient = useQueryClient();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Drop a repo folder anywhere on the window to open it.
  useRepoDrop();

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
      <WhatsNew />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {COLD_START && (
        <div className="pointer-events-none fixed right-2 bottom-2 z-50 flex items-center gap-1.5 border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
          <span className="size-1.5 rounded-full bg-amber-500" />
          Cold-start test mode
        </div>
      )}
    </>
  );
}

export default App;
