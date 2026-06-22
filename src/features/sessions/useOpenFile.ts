import { useCallback } from "react";
import { openWithDefault, openWithProgram } from "@/lib/git/api";
import { isWindows } from "@/lib/hotkeys/binding";
import { useSettings } from "@/lib/settings/queries";
import { toastError } from "@/lib/toast";

/**
 * Returns a callback that opens a repo-relative path (resolved against
 * `baseDir` — a session's worktree) in the user's configured external editor,
 * falling back to the OS default handler when none is set. Mirrors the
 * absolute-path construction used by the changes context menu.
 */
export function useOpenFile() {
  const settings = useSettings();
  const editorPath = (settings.data?.externalEditor ?? "").trim();
  return useCallback(
    (baseDir: string, relPath: string) => {
      const sep = isWindows ? "\\" : "/";
      const abs = `${baseDir}${sep}${relPath.replaceAll("/", sep)}`;
      const opened = editorPath
        ? openWithProgram(editorPath, abs)
        : openWithDefault(abs);
      opened.catch(toastError);
    },
    [editorPath],
  );
}
