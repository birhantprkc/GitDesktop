import { load, type Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { storeName } from "@/lib/test-mode";

/** Semantic tone for a notification's glyph — paired with an icon + word in the
 *  UI so state never rides on color alone (WCAG AA). */
export type NotificationTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "merged"
  | "neutral";

/** How clicking a notification routes. Data only — the surface maps it to the UI
 *  store's atomic navigation actions, so this module stays free of view logic. */
export type NotificationTarget =
  | { type: "pr"; kind: "remote" | "local"; ref: string }
  | { type: "run"; runId: number }
  | { type: "agent" }
  | { type: "repo" };

/** One terminal, notification-worthy event. Cross-repo: `repoName` is shown on
 *  the row and the target navigates (switching repos when needed). */
export interface AppNotification {
  id: string;
  /** Event kind — drives the glyph in the surface (see `notificationGlyph`). */
  kind: string;
  tone: NotificationTone;
  title: string;
  subtitle?: string;
  /** Epoch ms. */
  ts: number;
  read: boolean;
  repoPath: string;
  repoName: string;
  target?: NotificationTarget;
  /** Collapses accidental double-fires of the same transition (a re-render or a
   *  poll seam) within a short window — NOT persisted-across-restart dedup. */
  dedupeKey?: string;
}

/** Keep the history bounded — oldest drop out (even if unread; the count is a
 *  "recent activity" window, not an audit log). */
const CAP = 50;
const STORE_KEY = "items";
/** A repeated identical event inside this window is treated as a double-fire. */
const DEDUPE_WINDOW_MS = 8_000;

/** The valid tones — used to coerce a corrupt/older on-disk `tone` to a safe
 *  default so the glyph never renders uncolored. */
const TONES: ReadonlySet<string> = new Set<NotificationTone>([
  "success",
  "warning",
  "danger",
  "info",
  "merged",
  "neutral",
]);

// ---- Persistence (tauri-store; survives restart) ---------------------------
// A single global list (the inbox spans repos), unlike the per-repo local-PR
// store. autoSave flushes on a ~100ms debounce, which is fine here: a lost
// notification on a hard crash is acceptable, and there is no cross-write race
// (one window owns its own inbox; a second window keeps its own copy — an
// accepted v1 limit, matching the settings store's cross-window caveat).
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(storeName("notifications.json"), {
    autoSave: true,
    defaults: {},
  });
  return storePromise;
}

/** Shape-guard a value read back from disk — external/older files must never
 *  crash hydration; a malformed entry is simply dropped. */
function isValidNotification(x: unknown): x is AppNotification {
  if (typeof x !== "object" || x === null) return false;
  const n = x as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.kind === "string" &&
    typeof n.title === "string" &&
    typeof n.ts === "number" &&
    typeof n.read === "boolean" &&
    typeof n.repoPath === "string" &&
    typeof n.repoName === "string"
  );
}

async function persist(items: AppNotification[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(STORE_KEY, items);
  } catch {
    // best-effort — a failed persist must never break the work that fired it
  }
}

// ---- Reactive store --------------------------------------------------------
interface NotifState {
  items: AppNotification[];
  hydrated: boolean;
  hydrate: (items: AppNotification[]) => void;
  push: (n: AppNotification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clearAll: () => void;
}

const useNotifStore = create<NotifState>()((set) => ({
  items: [],
  hydrated: false,
  hydrate: (items) =>
    // Any notifications pushed before hydration finished are newer than the
    // persisted ones — keep them ahead of the disk history rather than dropping
    // them by replacing the array.
    set((s) => ({
      items: [...s.items, ...items].slice(0, CAP),
      hydrated: true,
    })),
  push: (n) => set((s) => ({ items: [n, ...s.items].slice(0, CAP) })),
  markRead: (id) =>
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)),
    })),
  markAllRead: () =>
    set((s) =>
      s.items.some((i) => !i.read)
        ? { items: s.items.map((i) => (i.read ? i : { ...i, read: true })) }
        : {},
    ),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clearAll: () => set((s) => (s.items.length > 0 ? { items: [] } : {})),
}));

// Persist on every post-hydration change; autoSave debounces the disk write.
useNotifStore.subscribe((state, prev) => {
  if (!state.hydrated || state.items === prev.items) return;
  void persist(state.items);
});

// Hydrate once at module load, before any push can arrive.
void (async () => {
  try {
    const store = await getStore();
    const raw = (await store.get<unknown[]>(STORE_KEY)) ?? [];
    const clean = (Array.isArray(raw) ? raw.filter(isValidNotification) : [])
      // Coerce an out-of-enum tone (hand-edited / older file) to neutral so the
      // glyph is never left uncolored.
      .map((n) => (TONES.has(n.tone) ? n : { ...n, tone: "neutral" as const }))
      .slice(0, CAP);
    useNotifStore.getState().hydrate(clean);
  } catch {
    useNotifStore.getState().hydrate([]);
  }
})();

// ---- Public API ------------------------------------------------------------

/**
 * Record a terminal event in the notifications inbox. Fire-and-forget: callers
 * push alongside their existing OS-notification / toast, so the inbox captures
 * the event even when the window was focused (no OS notification fires there).
 * Pass a `dedupeKey` to collapse an accidental repeat of the SAME transition
 * within a few seconds (genuine later repeats — fail → pass → fail — still land,
 * since the window has elapsed).
 */
export function pushNotification(input: {
  kind: string;
  tone: NotificationTone;
  title: string;
  subtitle?: string;
  repoPath: string;
  repoName: string;
  target?: NotificationTarget;
  dedupeKey?: string;
}): void {
  const now = Date.now();
  const { items } = useNotifStore.getState();
  if (
    input.dedupeKey &&
    items.some(
      (i) => i.dedupeKey === input.dedupeKey && now - i.ts < DEDUPE_WINDOW_MS,
    )
  ) {
    return;
  }
  useNotifStore.getState().push({
    id: crypto.randomUUID(),
    kind: input.kind,
    tone: input.tone,
    title: input.title,
    subtitle: input.subtitle,
    ts: now,
    read: false,
    repoPath: input.repoPath,
    repoName: input.repoName,
    target: input.target,
    dedupeKey: input.dedupeKey,
  });
}

/** All notifications, newest first (push prepends, so `items` is already ordered). */
export function useNotifications(): AppNotification[] {
  return useNotifStore((s) => s.items);
}

/** Unread count for the anchor badge. */
export function useUnreadCount(): number {
  return useNotifStore((s) =>
    s.items.reduce((n, i) => (i.read ? n : n + 1), 0),
  );
}

/** Repo display name from its path (the folder basename). The detector sites
 *  have the path but not always the canonical name; the basename matches how
 *  `RepoInfo.name` is derived and is enough for the row label + navigation. */
export function repoNameFromPath(repoPath: string): string {
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}

export const markNotificationRead = (id: string): void =>
  useNotifStore.getState().markRead(id);
export const markAllNotificationsRead = (): void =>
  useNotifStore.getState().markAllRead();
export const clearNotification = (id: string): void =>
  useNotifStore.getState().remove(id);
export const clearAllNotifications = (): void =>
  useNotifStore.getState().clearAll();
