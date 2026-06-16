import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { validateRepo } from "@/lib/git/api";
import { useAddRecentRepo } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

/**
 * Opens a git repository by dropping its folder onto the window. Subscribes
 * once; reads the latest store action / mutation via getState + a ref so the
 * native drag-drop handler isn't re-registered on every render.
 */
export function useRepoDrop() {
  const addRecent = useAddRecentRepo();
  const addRecentRef = useRef(addRecent);
  addRecentRef.current = addRecent;

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      const path = event.payload.paths[0];
      if (!path) return;
      try {
        const info = await validateRepo(path);
        addRecentRef.current.mutate({ path: info.root, name: info.name });
        useUiStore.getState().openRepo(info);
      } catch (e) {
        // Not a git repo (or a file, not a folder) — surface why.
        toastError(e);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
}
