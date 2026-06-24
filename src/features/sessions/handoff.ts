import { useUiStore } from "@/lib/stores/ui";
import { clearAgentSelection } from "./agentSelect";
import { useSessionsStore } from "./store";

/**
 * Hand a task to a NEW write-capable agent session. Rather than spending tokens
 * immediately, it seeds the "Delegate a task" composer with `prompt` and surfaces
 * it — the user picks the agent/model/effort and hits Delegate, the human gate
 * before any code is written. Callers build their own framing of the prompt (the
 * plan "Implement now" implements a vetted spec; an issue's "Solve with agent"
 * frames it as investigate → fix).
 *
 * Wiring: clear both agent selections so the activation composer shows, stash the
 * seed (consumed across the Agent tab's Activity boundary), then navigate.
 */
export function handoffToAgent(repoPath: string, prompt: string) {
  clearAgentSelection();
  useSessionsStore.getState().setPendingTask({ repoPath, prompt });
  useUiStore.getState().setRepoTab("agent");
}
