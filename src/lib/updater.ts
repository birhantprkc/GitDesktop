import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type { Update };

/** Checks the configured GitHub Releases endpoint; null = already up to date. */
export function checkForUpdate(): Promise<Update | null> {
  return check();
}

export interface DownloadProgress {
  downloaded: number;
  /** Total bytes, when the server reported a content length. */
  total: number | null;
}

/**
 * Downloads + installs an update (reporting byte progress), then relaunches
 * into the new version — so this normally does not return.
 */
export async function installUpdate(
  update: Update,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.({ downloaded: 0, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        onProgress?.({ downloaded: total ?? downloaded, total });
        break;
    }
  });
  await relaunch();
}
