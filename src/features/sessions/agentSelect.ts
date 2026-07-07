import { usePlanStore } from "@/features/plan/store";
import { useResearchStore } from "@/features/research/store";
import { currentNavVersion } from "./navVersion";
import { useSessionsStore } from "./store";

/**
 * The agent canvas shows exactly one of: a session, a plan, a research run, or
 * the new-task composer. Each lives in its own store, so these helpers keep the
 * selections mutually exclusive — selecting one clears the others. Every
 * user-driven selection in the sidebar (and the handoff / issue-plan entries)
 * goes through here so the stores themselves stay decoupled.
 */
export function selectSession(id: string) {
  usePlanStore.getState().setActivePlan(null);
  useResearchStore.getState().setActiveResearch(null);
  useSessionsStore.getState().setActive(id);
}

export function selectPlan(id: string) {
  useSessionsStore.getState().setActive(null);
  useResearchStore.getState().setActiveResearch(null);
  usePlanStore.getState().setActivePlan(id);
}

export function selectResearch(id: string) {
  useSessionsStore.getState().setActive(null);
  usePlanStore.getState().setActivePlan(null);
  useResearchStore.getState().setActiveResearch(id);
}

/** Clear all selections — shows the new-task composer (activation surface). */
export function clearAgentSelection() {
  // Calls three setters, each of which bumps navVersion once — so a single
  // "deselect everything" advances the counter by 3. Harmless: navVersion only
  // signals "something changed" (see navVersion.ts), so over-counting never breaks
  // the handoff guard; don't be surprised by the jump when debugging drift.
  usePlanStore.getState().setActivePlan(null);
  useResearchStore.getState().setActiveResearch(null);
  useSessionsStore.getState().setActive(null);
}

/** A snapshot of which agent surface is selected (research / plan / session, or
 *  none), plus the nav-version counter at capture time. The three stores are
 *  mutually exclusive, so at most one id is set. Used to detect whether the user
 *  navigated away (and possibly back) during an async handoff. */
export interface AgentSelectionSnapshot {
  research: string | null;
  plan: string | null;
  session: string | null;
  /** The monotonic nav counter (navVersion.ts) at capture — the source of truth
   *  for "did the selection change since capture". Catches an X→Y→X round trip that
   *  the ids alone cannot (they equal X again at the end). */
  version: number;
}

/** Capture the current agent-surface selection so an async flow can tell, on
 *  completion, whether the user has since navigated elsewhere. */
export function captureAgentSelection(): AgentSelectionSnapshot {
  return {
    research: useResearchStore.getState().activeResearchId,
    plan: usePlanStore.getState().activePlanId,
    session: useSessionsStore.getState().activeId,
    version: currentNavVersion(),
  };
}

/** True if the selection is unchanged since a captured snapshot — the user is still
 *  on the surface they clicked from, so a completing handoff may navigate. The
 *  version counter is primary: it ticks on EVERY selection change (via the store
 *  setters), so it also catches an X→Y→X round trip where the ids alone would
 *  wrongly read "unchanged" and yank a user who deliberately navigated back. The id
 *  equality is kept as a secondary belt-and-suspenders guard. */
export function agentSelectionUnchanged(snap: AgentSelectionSnapshot): boolean {
  if (snap.version !== currentNavVersion()) return false;
  const now = captureAgentSelection();
  return (
    now.research === snap.research &&
    now.plan === snap.plan &&
    now.session === snap.session
  );
}
