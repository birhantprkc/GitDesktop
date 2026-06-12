import { create } from "zustand";
import type { ReviewMode } from "@/lib/ai/types";

export interface AutomationRunResult {
  id: string;
  repoPath: string;
  /** What was reviewed — a commit subject or PR title. */
  subject: string;
  mode: ReviewMode;
  text: string;
  createdAt: string;
}

interface AutomationResultsState {
  /** Newest first, capped — results are session-scoped, not persisted. */
  results: AutomationRunResult[];
  /** Result shown in the viewer dialog, if any. */
  openId: string | null;
  add: (result: AutomationRunResult) => void;
  setOpen: (id: string | null) => void;
}

export const useAutomationResults = create<AutomationResultsState>()((set) => ({
  results: [],
  openId: null,
  add: (result) =>
    set((s) => ({ results: [result, ...s.results].slice(0, 20) })),
  setOpen: (id) => set({ openId: id }),
}));
