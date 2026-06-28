import { usePlanStore } from "@/features/plan/store";
import { useResearchStore } from "@/features/research/store";
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
  usePlanStore.getState().setActivePlan(null);
  useResearchStore.getState().setActiveResearch(null);
  useSessionsStore.getState().setActive(null);
}
