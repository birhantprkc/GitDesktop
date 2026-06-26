import { useUiStore } from "@/lib/stores/ui";

/**
 * True when the user is actually looking at agent surface `id` right now: the
 * window is focused, the **Agent tab** is the visible tab, and `id` is the
 * selected plan/session.
 *
 * Both agent stores use this to decide whether a finished run still needs an OS
 * notification — staying quiet only when the result is already on screen.
 * `document.hasFocus()` alone is window-level: it can't tell the Agent tab from
 * Changes/Pulls, so a focused user on a different tab was wrongly treated as
 * "watching" and got no nudge. Plan and session selection are mutually exclusive
 * (see `agentSelect.ts`), so `activeId === id` plus `repoTab === "agent"` is a
 * precise "this exact surface is on screen".
 */
export function isWatchingAgentSurface(
  activeId: string | null,
  id: string,
): boolean {
  return (
    document.hasFocus() &&
    useUiStore.getState().repoTab === "agent" &&
    activeId === id
  );
}
