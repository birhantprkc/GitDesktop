import { SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { MODEL_SUGGESTIONS } from "@/lib/ai/providers";
import { cn } from "@/lib/utils";
import { type SessionTurn, useSessionsStore } from "./store";

const CLAUDE_MODELS = MODEL_SUGGESTIONS["claude-cli"];

/**
 * The agent-session sidebar: a model picker, a scrolling conversation (your
 * messages + the agent's streamed replies, one per turn), and a composer to
 * start a session or send a follow-up. The diff + Keep/Discard live in the main
 * pane (SessionView) — conversation on one side, changes on the other.
 */
export function SessionsPanel({ repoPath }: { repoPath: string }) {
  const session = useSessionsStore((s) => s.session);
  const busy = useSessionsStore((s) => s.busy);
  const running = useSessionsStore((s) => s.running);
  const start = useSessionsStore((s) => s.start);
  const send = useSessionsStore((s) => s.send);
  const setModel = useSessionsStore((s) => s.setModel);
  const cancel = useSessionsStore((s) => s.cancel);
  const [draft, setDraft] = useState("");
  // Model selection before a session exists; once it does, it lives on the session.
  const [startModel, setStartModel] = useState("");

  const model = session ? session.model : startModel;
  const onModel = session ? setModel : setStartModel;
  const canSubmit = !running && !busy && draft.trim().length > 0;

  const submit = () => {
    const text = draft.trim();
    if (!text || running || busy) return;
    if (session) send(text);
    else start(repoPath, text, startModel);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <SparkleIcon className="size-4 text-primary" />
          Agent session
        </div>
        <ModelPicker value={model} onChange={onModel} className="ml-auto" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!session ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Delegate a task to an AI agent. It runs full-auto in an isolated
            worktree — your working tree, index, and branch are never touched —
            and you can keep iterating with it in this conversation before
            keeping or discarding its work.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {session.turns.map((turn, i) => (
              <TurnView key={`${i}:${turn.prompt}`} turn={turn} />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t p-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            session
              ? "Send a follow-up… (⌘/Ctrl+Enter)"
              : "Describe the change… e.g. “Add input validation to the login form”"
          }
          className="min-h-20 resize-none text-xs"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={submit}
            className="flex-1"
          >
            {session ? "Send" : busy ? "Starting…" : "Start agent session"}
          </Button>
          {running && (
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// "" (account default) maps to a non-empty sentinel for the Select value.
const DEFAULT_MODEL = "default";

function ModelPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (m: string) => void;
  className?: string;
}) {
  return (
    <Select
      value={value || DEFAULT_MODEL}
      onValueChange={(v) => onChange(v === DEFAULT_MODEL ? "" : String(v))}
    >
      <SelectTrigger
        size="sm"
        aria-label="Agent model"
        className={cn("text-muted-foreground", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
        {CLAUDE_MODELS.map((m) => (
          <SelectItem key={m} value={m}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TurnView({ turn }: { turn: SessionTurn }) {
  const active = turn.status === "running" || turn.status === "committing";
  return (
    <div className="border-b pb-3 last:border-0 last:pb-0">
      <div className="rounded-md bg-muted/60 px-2 py-1.5 text-xs break-words whitespace-pre-wrap">
        {turn.prompt}
      </div>
      {turn.narration && (
        <pre className="mt-1.5 font-sans text-[11px] break-words whitespace-pre-wrap text-foreground/90">
          {turn.narration}
        </pre>
      )}
      <div
        className={cn(
          "mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground",
          turn.status === "error" && "text-destructive",
        )}
      >
        {active && <Spinner className="size-3" />}
        {turn.statusText ||
          (turn.status === "error"
            ? (turn.error ?? "Failed")
            : turn.status === "done" && turn.commitHash
              ? "Committed"
              : turn.status === "done"
                ? "No changes"
                : "")}
        {turn.costUsd != null && <span>· ${turn.costUsd.toFixed(3)}</span>}
      </div>
    </div>
  );
}
