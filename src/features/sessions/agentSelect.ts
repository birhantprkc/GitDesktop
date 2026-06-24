import { usePlanStore } from "@/features/plan/store";
import { useSessionsStore } from "./store";

/**
 * The agent canvas shows exactly one of: a session, a plan, or the new-task
 * composer. Sessions and plans live in separate stores, so these helpers keep the
 * two selections mutually exclusive — selecting one clears the other. Every
 * user-driven selection in the sidebar (and the handoff / issue-plan entries)
 * goes through here so the stores themselves stay decoupled.
 */
export function selectSession(id: string) {
  usePlanStore.getState().setActivePlan(null);
  useSessionsStore.getState().setActive(id);
}

export function selectPlan(id: string) {
  useSessionsStore.getState().setActive(null);
  usePlanStore.getState().setActivePlan(id);
}

/** Clear both selections — shows the new-task composer (activation surface). */
export function clearAgentSelection() {
  usePlanStore.getState().setActivePlan(null);
  useSessionsStore.getState().setActive(null);
}
