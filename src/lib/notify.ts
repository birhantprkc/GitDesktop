import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

async function ensurePermission(): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  return granted;
}

/**
 * Send an OS notification (requesting permission if needed). The caller decides
 * *when* it's warranted; use this when "unfocused" isn't the right gate — e.g.
 * an agent session finishing while you're focused on a *different* session.
 * Failures are swallowed: a missed notification must never break the work that
 * triggered it.
 */
export async function notify(title: string, body?: string): Promise<void> {
  try {
    if (await ensurePermission()) sendNotification({ title, body });
  } catch {
    // ignore
  }
}

/**
 * OS notification for long-running background work, sent only when the
 * window isn't focused — in-app toasts already cover the focused case.
 */
export async function notifyIfUnfocused(
  title: string,
  body?: string,
): Promise<void> {
  if (document.hasFocus()) return;
  await notify(title, body);
}
