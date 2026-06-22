import { load, type Store } from "@tauri-apps/plugin-store";
import { storeName } from "@/lib/test-mode";
import type { AgentSession } from "./store";

// Agent sessions persist in their own store file (separate from settings) so a
// reload/restart doesn't lose them — their worktrees + Claude transcripts live
// on disk and can be resumed. autoSave flushes writes for us.
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(storeName("agent-sessions.json"), {
    autoSave: true,
    defaults: {},
  });
  return storePromise;
}

export async function loadPersistedSessions(): Promise<AgentSession[]> {
  const store = await getStore();
  return (await store.get<AgentSession[]>("sessions")) ?? [];
}

export async function persistSessions(sessions: AgentSession[]): Promise<void> {
  const store = await getStore();
  await store.set("sessions", sessions);
}
