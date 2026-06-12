import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/**
 * OS notification for long-running background work, sent only when the
 * window isn't focused — in-app toasts already cover the focused case.
 * Failures are swallowed: a missed notification must never break the work
 * that triggered it.
 */
export async function notifyIfUnfocused(
  title: string,
  body?: string,
): Promise<void> {
  try {
    if (document.hasFocus()) return;
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch {
    // ignore
  }
}
