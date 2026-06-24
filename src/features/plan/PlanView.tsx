import {
  ArrowLeftIcon,
  SparkleIcon,
  StopIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AgentNarration } from "@/features/sessions/AgentNarration";
import { AgentPicker, ModelPicker } from "@/features/sessions/SessionComposer";
import type { AgentKind } from "@/lib/ai/agent";
import { MODEL_SUGGESTIONS } from "@/lib/ai/providers";
import { useGhStatus } from "@/lib/git/queries";
import { isMac } from "@/lib/hotkeys/binding";
import { useUiStore } from "@/lib/stores/ui";
import { CreateLocalIssueDialog } from "../issues/CreateLocalIssueDialog";
import { type PlanSeed, usePlanStore } from "./store";

const MODELS: Record<AgentKind, string[]> = {
  claude: MODEL_SUGGESTIONS["claude-cli"],
  codex: MODEL_SUGGESTIONS["codex-cli"],
  copilot: MODEL_SUGGESTIONS["copilot-cli"],
  opencode: MODEL_SUGGESTIONS["opencode-cli"],
};

/**
 * The read-only planning canvas — peer of the session canvas in the agent
 * surface. Empty/seeded: a composer that runs a Tier-2 repo-aware agent to draft
 * an agent-ready issue. Running/done: the streamed plan + a human gate to file
 * it as a local or GitHub issue (with a warning for any cited path that doesn't
 * resolve to a real file).
 */
export function PlanView({ repoPath }: { repoPath: string }) {
  const generating = usePlanStore((s) => s.generating);
  const text = usePlanStore((s) => s.text);
  const draft = usePlanStore((s) => s.draft);
  const error = usePlanStore((s) => s.error);
  const seed = usePlanStore((s) => s.seed);
  const close = usePlanStore((s) => s.close);

  const started =
    generating || text.length > 0 || draft !== null || error !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b p-3 text-sm font-medium">
        <SparkleIcon className="size-4 text-primary" />
        Plan a task
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-1.5 text-muted-foreground"
          onClick={close}
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to sessions
        </Button>
      </div>
      {started ? (
        <PlanResult repoPath={repoPath} />
      ) : (
        <PlanComposer repoPath={repoPath} seed={seed} />
      )}
    </div>
  );
}

export function PlanComposer({
  repoPath,
  seed,
}: {
  repoPath: string;
  seed: PlanSeed | null;
}) {
  const generate = usePlanStore((s) => s.generate);
  const [goal, setGoal] = useState(seed?.goal ?? "");
  const [agent, setAgent] = useState<AgentKind>("claude");
  const [model, setModel] = useState("");

  const planningIssue = Boolean(seed?.issueTitle || seed?.issueBody);
  const canPlan = goal.trim().length > 0 || planningIssue;

  const submit = () => {
    if (!canPlan) return;
    generate({
      repoPath,
      goal,
      issueTitle: seed?.issueTitle,
      issueBody: seed?.issueBody,
      agent,
      model,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-xl flex-col gap-5">
        <div className="flex flex-col gap-2 text-center">
          <h2 className="text-base font-medium text-balance">
            Plan a task, grounded in your code
          </h2>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            A read-only agent explores the repo and drafts an agent-ready issue
            — problem, approach, affected files, acceptance criteria, and a
            verify plan. Nothing is changed; review it, then file it as an
            issue.
          </p>
        </div>

        {planningIssue && (
          <div className="border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-xs">
            <p className="text-muted-foreground">Planning this issue:</p>
            <p className="mt-0.5 font-medium">{seed?.issueTitle}</p>
          </div>
        )}

        <div className="flex flex-col gap-2 border p-3">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            autoFocus
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              planningIssue
                ? "Optional: extra guidance for the plan…"
                : "Describe the task to plan (e.g. “add rate limiting to the API client”)…"
            }
            aria-label="Describe a task to plan"
            className="max-h-48 min-h-16 w-full resize-none bg-transparent text-xs leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-2 border-t pt-2">
            <AgentPicker
              value={agent}
              onChange={(a) => {
                setAgent(a);
                setModel("");
              }}
            />
            <ModelPicker
              value={model}
              onChange={setModel}
              models={MODELS[agent]}
            />
            <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
              {isMac ? "⌘↵" : "Ctrl+↵"} to plan
            </span>
            <Button
              size="sm"
              className="ml-auto min-w-20"
              disabled={!canPlan}
              onClick={submit}
            >
              Plan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanResult({ repoPath }: { repoPath: string }) {
  const generating = usePlanStore((s) => s.generating);
  const text = usePlanStore((s) => s.text);
  const status = usePlanStore((s) => s.status);
  const draft = usePlanStore((s) => s.draft);
  const error = usePlanStore((s) => s.error);
  const cancel = usePlanStore((s) => s.cancel);
  const back = usePlanStore((s) => s.back);
  const close = usePlanStore((s) => s.close);

  const setPendingIssueDraft = useUiStore((s) => s.setPendingIssueDraft);
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  const gh = useGhStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const [localOpen, setLocalOpen] = useState(false);

  const createGithub = () => {
    if (!draft) return;
    setPendingIssueDraft({ title: draft.title, body: draft.body });
    setRepoTab("issues");
    close();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(generating || status) && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[11px] text-muted-foreground">
          {generating && (
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
          )}
          <span className="truncate">
            {status || (generating ? "Exploring the repository…" : "")}
          </span>
          {generating && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={cancel}
            >
              <StopIcon weight="fill" />
              Stop
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {error ? (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <WarningIcon className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : text ? (
          <div className="text-xs leading-relaxed">
            <AgentNarration text={text} baseDir={repoPath} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Starting…</p>
        )}
      </div>

      {(draft || error) && (
        <div className="shrink-0 border-t">
          {draft && draft.unverified.length > 0 && (
            <div className="flex items-start gap-2 border-b bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
              <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {draft.unverified.length} cited path
                {draft.unverified.length === 1 ? "" : "s"} couldn't be matched
                to a real file — double-check before filing:{" "}
                <span className="font-mono">{draft.unverified.join(", ")}</span>
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Button variant="outline" size="sm" onClick={back}>
              Re-plan
            </Button>
            {draft && (
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocalOpen(true)}
                >
                  Create local issue
                </Button>
                {ghReady && (
                  <Button size="sm" onClick={createGithub}>
                    Create GitHub issue
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <CreateLocalIssueDialog
        repoPath={repoPath}
        open={localOpen}
        onOpenChange={setLocalOpen}
        initialDraft={
          draft ? { title: draft.title, body: draft.body } : undefined
        }
      />
    </div>
  );
}
