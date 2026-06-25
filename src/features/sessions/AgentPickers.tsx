import { GaugeIcon, UsersThreeIcon } from "@phosphor-icons/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentKind } from "@/lib/ai/agent";
import { MODEL_SUGGESTIONS } from "@/lib/ai/providers";

// The agent / model / effort pickers, shared by the task composer, the plan
// composer, the plan's Implement popover, and the best-of-N arm editor. Kept in
// their own module so those surfaces don't import each other (the composer imports
// the ensemble dialog, which needs the pickers — a cycle if they lived together).

const CLAUDE_MODELS = MODEL_SUGGESTIONS["claude-cli"];
const CODEX_MODELS = MODEL_SUGGESTIONS["codex-cli"];
const COPILOT_MODELS = MODEL_SUGGESTIONS["copilot-cli"];
const OPENCODE_MODELS = MODEL_SUGGESTIONS["opencode-cli"];

/** The suggested model list for an agent (each CLI exposes different models). */
export function modelsForAgent(agent: AgentKind): string[] {
  switch (agent) {
    case "codex":
      return CODEX_MODELS;
    case "copilot":
      return COPILOT_MODELS;
    case "opencode":
      return OPENCODE_MODELS;
    default:
      return CLAUDE_MODELS;
  }
}

// "" (account default) maps to a non-empty sentinel for the Select value.
const DEFAULT_MODEL = "default";

export function ModelPicker({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (m: string) => void;
  models: string[];
}) {
  return (
    <Select
      value={value || DEFAULT_MODEL}
      onValueChange={(v) => onChange(v === DEFAULT_MODEL ? "" : String(v))}
    >
      <SelectTrigger
        size="sm"
        aria-label="Agent model"
        className="w-auto border-0 text-muted-foreground shadow-none hover:bg-muted dark:bg-transparent"
      >
        <SelectValue />
      </SelectTrigger>
      {/* Models come from a narrow (w-auto) trigger, so the default
          `w-(--anchor-width)` popup clips long ids (e.g. `opencode/…`). Let it
          size to its content instead, capped so it can't run off-screen. */}
      <SelectContent className="w-fit max-w-sm">
        <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
        {models.map((m) => (
          <SelectItem key={m} value={m}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const DEFAULT_EFFORT = "default";
const EFFORT_LEVELS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Max" },
] as const;

/** Reasoning/effort level for the next turn. Mapped per-CLI in Rust (Codex
 *  `model_reasoning_effort`, Copilot `--effort`, Claude a thinking keyword). The
 *  gauge icon marks it as effort so the collapsed value isn't mistaken for a model. */
export function EffortPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (e: string) => void;
}) {
  return (
    <Select
      value={value || DEFAULT_EFFORT}
      onValueChange={(v) => onChange(v === DEFAULT_EFFORT ? "" : String(v))}
    >
      <SelectTrigger
        size="sm"
        aria-label="Reasoning effort"
        className="w-auto gap-1 border-0 text-muted-foreground shadow-none hover:bg-muted dark:bg-transparent"
      >
        <GaugeIcon className="size-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_EFFORT}>Default</SelectItem>
        {EFFORT_LEVELS.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** How a new task runs: one session, or best-of-N across several arms. */
export type RunMode = "single" | "ensemble";

/** Selects the run mode for a NEW task (activation composer only). Always
 *  clickable — unlike the Send button it isn't gated on a typed prompt — so you can
 *  choose best-of-N before typing. `Send` then follows the mode; the per-arm setup
 *  lives in the best-of-N dialog. */
export function RunModePicker({
  value,
  onChange,
}: {
  value: RunMode;
  onChange: (m: RunMode) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v === "ensemble" ? "ensemble" : "single")}
    >
      <SelectTrigger
        size="sm"
        aria-label="Run mode"
        title="Run once, or several ways and keep the best (best-of-N)"
        className="w-auto gap-1 border-0 text-muted-foreground shadow-none hover:bg-muted dark:bg-transparent"
      >
        <UsersThreeIcon className="size-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="single">Single run</SelectItem>
        <SelectItem value="ensemble">Best-of-N</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Picks the CLI for a NEW session (fixed once it starts). Every agent honors the
 *  isolation setting — host (worktree-confined, soft) or container — provided that
 *  agent is baked into the image (Codex is container-only). Reused by the plan
 *  composer and the best-of-N arm editor. */
export function AgentPicker({
  value,
  onChange,
}: {
  value: AgentKind;
  onChange: (a: AgentKind) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) =>
        onChange(
          v === "copilot"
            ? "copilot"
            : v === "codex"
              ? "codex"
              : v === "opencode"
                ? "opencode"
                : "claude",
        )
      }
    >
      <SelectTrigger
        size="sm"
        aria-label="Agent"
        className="w-auto border-0 text-muted-foreground shadow-none hover:bg-muted dark:bg-transparent"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="claude">Claude</SelectItem>
        <SelectItem value="codex">Codex</SelectItem>
        <SelectItem value="copilot">GitHub Copilot</SelectItem>
        <SelectItem value="opencode">opencode</SelectItem>
      </SelectContent>
    </Select>
  );
}
