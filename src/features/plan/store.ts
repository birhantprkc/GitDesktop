import { create } from "zustand";
import { type AgentKind, cancelAgentReview } from "@/lib/ai/agent";
import {
  buildPlanPrompt,
  extractPlanDraft,
  validatePlanPaths,
} from "@/lib/ai/prompt";
import { runCliStream } from "@/lib/ai/stream";
import type { AiProviderId, AiSettings } from "@/lib/ai/types";
import { gitListTracked, readRepoInstructions } from "@/lib/git/api";
import { loadSettings } from "@/lib/settings/api";
import { errorMessage } from "@/lib/tauri/invoke";

export interface PlanDraft {
  title: string;
  body: string;
  /** Cited paths that didn't resolve to a real tracked file/dir — possible
   *  hallucinations for the human gate to scrutinize before filing the issue. */
  unverified: string[];
}

/** Prefill for the plan composer — a free-form goal and/or an existing issue. */
export interface PlanSeed {
  goal?: string;
  issueTitle?: string | null;
  issueBody?: string | null;
}

interface GenerateArgs extends PlanSeed {
  repoPath: string;
  /** Planning needs repo-aware reads, which only the CLI agents have. */
  agent: AgentKind;
  model: string;
}

interface PlanState {
  /** Whether the plan canvas is open (takes over the agent surface). */
  active: boolean;
  repoPath: string | null;
  /** Prefill for the composer (e.g. the issue being planned). */
  seed: PlanSeed | null;
  generating: boolean;
  /** The streamed plan markdown. */
  text: string;
  /** Transient tool-activity note (e.g. "Reading files…"). */
  status: string;
  /** Parsed + path-validated result, set when the run completes. */
  draft: PlanDraft | null;
  error: string | null;
  cancelId: string | null;

  /** Open the (empty or seeded) plan composer in `repoPath`'s agent surface. */
  open: (repoPath: string, seed?: PlanSeed) => void;
  /** Leave the plan canvas (cancels any in-flight run). */
  close: () => void;
  /** Clear the result and return to the composer, keeping the seed. */
  back: () => void;
  generate: (args: GenerateArgs) => Promise<void>;
  cancel: () => void;
}

function repoName(p: string): string {
  return (
    p
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? p
  );
}

/**
 * Read-only planning surface. A plan run drives the **Tier-2 (repo-aware) agent
 * CLI** — the same read-only `agent_review` backend code review uses — to explore
 * the repo and emit an agent-ready issue, then validates cited paths against
 * `git ls-files`. State lives in a store (not a component) so the "Analyze & plan"
 * entry on the Issues surface can drive it and it survives navigation. Never
 * writes: the CLI `--tools Read,Grep,Glob` restriction is the hard guarantee.
 */
export const usePlanStore = create<PlanState>((set, get) => ({
  active: false,
  repoPath: null,
  seed: null,
  generating: false,
  text: "",
  status: "",
  draft: null,
  error: null,
  cancelId: null,

  open: (repoPath, seed) =>
    set({
      active: true,
      repoPath,
      seed: seed ?? null,
      text: "",
      status: "",
      draft: null,
      error: null,
    }),

  close: () => {
    const id = get().cancelId;
    if (id) void cancelAgentReview(id);
    set({
      active: false,
      generating: false,
      cancelId: null,
      text: "",
      status: "",
      draft: null,
      error: null,
      seed: null,
    });
  },

  back: () => set({ text: "", status: "", draft: null, error: null }),

  generate: async ({
    repoPath,
    goal = "",
    issueTitle,
    issueBody,
    agent,
    model,
  }) => {
    set({
      active: true,
      repoPath,
      generating: true,
      text: "",
      status: "",
      draft: null,
      error: null,
    });
    try {
      const [repoInstructions, tracked, settings] = await Promise.all([
        readRepoInstructions(repoPath).catch(() => null),
        gitListTracked(repoPath).catch(() => [] as string[]),
        loadSettings().catch(() => null),
      ]);
      const { system, prompt } = buildPlanPrompt({
        goal,
        issueTitle,
        issueBody,
        repoName: repoName(repoPath),
        repoInstructions,
        globalInstructions: settings?.globalInstructions ?? "",
      });
      // A synthetic CLI AiSettings: repo-aware forced on so the agent explores.
      const ai: AiSettings = {
        provider: `${agent}-cli` as AiProviderId,
        model,
        ollamaBaseUrl: "",
        openaiCompatibleBaseUrl: "",
        cliRepoAware: true,
      };
      let finalText = "";
      await runCliStream({
        ai,
        system,
        prompt,
        repoPath,
        setText: (t) => {
          finalText = t;
          set({ text: t });
        },
        setStatus: (s) => set({ status: s }),
        registerId: (id) => set({ cancelId: id }),
      });
      const { title, body } = extractPlanDraft(finalText);
      if (!body.trim()) {
        set({ error: "The planner returned nothing — try again." });
        return;
      }
      set({
        draft: {
          title,
          body,
          unverified: validatePlanPaths(body, new Set(tracked)),
        },
      });
    } catch (e) {
      set({ error: errorMessage(e) });
    } finally {
      set({ generating: false, cancelId: null });
    }
  },

  cancel: () => {
    const id = get().cancelId;
    if (id) void cancelAgentReview(id);
  },
}));
