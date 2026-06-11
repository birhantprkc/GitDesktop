import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { RepositoryView } from "@/features/repository/RepositoryView";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { GitMissingScreen } from "@/features/welcome/GitMissingScreen";
import { WelcomeScreen } from "@/features/welcome/WelcomeScreen";
import { useGitInstalled } from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";

function App() {
  const view = useUiStore((s) => s.view);
  const openSettings = useUiStore((s) => s.openSettings);
  const gitInstalled = useGitInstalled();
  const queryClient = useQueryClient();

  // Ctrl+, (Cmd+, on macOS) opens settings — the platform convention.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        openSettings();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSettings]);

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

  switch (view) {
    case "welcome":
      return <WelcomeScreen />;
    case "repo":
      return <RepositoryView />;
    case "settings":
      return <SettingsScreen />;
  }
}

export default App;
