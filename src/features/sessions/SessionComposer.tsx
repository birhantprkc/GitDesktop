import { GaugeIcon, StopIcon } from "@phosphor-icons/react";
import { AnimatePresence, m } from "motion/react";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODEL_SUGGESTIONS } from "@/lib/ai/providers";
import {
  buildPrompt,
  filterCommands,
  findCommand,
  mergeCommands,
  parseSlashInvocation,
  type SlashCommand,
} from "@/lib/ai/slash";
import { useAgentCommands, useTrackedFiles } from "@/lib/git/queries";
import { quickTransition } from "@/lib/motion";
import { useSettings } from "@/lib/settings/queries";
import { cn } from "@/lib/utils";
import { type AgentSession, useSessionsStore } from "./store";

const CLAUDE_MODELS = MODEL_SUGGESTIONS["claude-cli"];
const CODEX_MODELS = MODEL_SUGGESTIONS["codex-cli"];
const COPILOT_MODELS = MODEL_SUGGESTIONS["copilot-cli"];
const OPENCODE_MODELS = MODEL_SUGGESTIONS["opencode-cli"];
// "" (account default) maps to a non-empty sentinel for the Select value.
const DEFAULT_MODEL = "default";
const MAX_MENTIONS = 8;

/** An in-progress `@file` mention: the query typed after `@` and the index of
 *  the `@` in the draft (so it can be replaced on selection). */
interface Mention {
  query: string;
  start: number;
}

export interface SessionComposerHandle {
  /** Load `text` into the composer for editing (focus it, caret at end). */
  setPrompt: (text: string) => void;
}

/**
 * The agent task composer, modeled on Claude Code's VS Code input: a single
 * auto-growing box (grows with content, capped, then scrolls) pinned at the
 * bottom, with the model picker and Send/Stop on its bottom edge. Enter sends,
 * Shift+Enter inserts a newline. Type `@` to mention a repo file. Used in two
 * places with the same logic — the activation panel (no session → `start`) and
 * the conversation footer (active session → `send` a follow-up).
 */
export function SessionComposer({
  repoPath,
  session,
  examples,
  autoFocus,
  handleRef,
}: {
  repoPath: string;
  /** null = start a new session; otherwise send a follow-up to this one. */
  session: AgentSession | null;
  /** Quick-fill suggestions shown above the box while it's empty (activation). */
  examples?: string[];
  autoFocus?: boolean;
  /** Imperative handle so a turn's "Edit & resend" can load its prompt here. */
  handleRef?: React.Ref<SessionComposerHandle>;
}) {
  const start = useSessionsStore((s) => s.start);
  const send = useSessionsStore((s) => s.send);
  const setModel = useSessionsStore((s) => s.setModel);
  const setEffort = useSessionsStore((s) => s.setEffort);
  const cancel = useSessionsStore((s) => s.cancel);
  const creating = useSessionsStore((s) => s.creating);
  const pendingTask = useSessionsStore((s) => s.pendingTask);
  const setPendingTask = useSessionsStore((s) => s.setPendingTask);
  const [draft, setDraft] = useState("");
  const [startModel, setStartModel] = useState("");
  const [startEffort, setStartEffort] = useState("");
  const [startAgent, setStartAgent] = useState<
    "claude" | "codex" | "copilot" | "opencode"
  >("claude");
  const [mention, setMention] = useState<Mention | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // An in-progress `/command` (the query typed after the leading `/`). Only
  // ever set when `/` opens the draft, so it owns the whole draft on selection.
  const [slash, setSlash] = useState<{ query: string } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  // Prompt-history navigation (terminal-style Up/Down recall). `histIndex` null
  // = showing the live draft; `histStash` holds that draft while browsing.
  const [histIndex, setHistIndex] = useState<number | null>(null);
  const [histStash, setHistStash] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const running = session?.running ?? false;
  const model = session ? session.model : startModel;
  // Agent is fixed once a session exists; while starting, it's user-selectable.
  const agent = session ? session.agent : startAgent;
  const models =
    agent === "codex"
      ? CODEX_MODELS
      : agent === "copilot"
        ? COPILOT_MODELS
        : agent === "opencode"
          ? OPENCODE_MODELS
          : CLAUDE_MODELS;
  const onModel = session
    ? (m: string) => setModel(session.id, m)
    : setStartModel;
  // Effort is changeable mid-session (like model). Mapped per-CLI in Rust (Codex
  // config, Copilot/opencode flags, Claude thinking keyword).
  const effort = session ? session.effort : startEffort;
  const onEffort = session
    ? (e: string) => setEffort(session.id, e)
    : setStartEffort;
  const canSubmit = !running && !creating && draft.trim().length > 0;
  // Your sent prompts, oldest→newest, for Up/Down recall.
  const history = session ? session.turns.map((t) => t.prompt) : [];

  const setDraftCaretEnd = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
    });
  };

  // Load a prompt into the box from outside (a turn's "Edit & resend").
  // biome-ignore lint/correctness/useExhaustiveDependencies: only uses stable setters/ref
  useImperativeHandle(
    handleRef,
    () => ({
      setPrompt: (text: string) => {
        setMention(null);
        setHistIndex(null);
        setDraftCaretEnd(text);
      },
    }),
    [],
  );

  // Seed the new-session composer from a handoff ("Implement this issue" / the
  // plan canvas's "Implement now"). Only the activation composer (no session)
  // consumes it; clear it once loaded so it doesn't re-seed. The Agent tab lives
  // under <Activity>, so this effect runs when the tab becomes visible — by which
  // point SessionActivation has forced "Delegate" mode and mounted this composer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable setters/ref only
  useEffect(() => {
    if (session || !pendingTask || pendingTask.repoPath !== repoPath) return;
    setMention(null);
    setSlash(null);
    setHistIndex(null);
    setDraftCaretEnd(pendingTask.prompt);
    setPendingTask(null);
  }, [session, pendingTask, repoPath]);

  const recallOlder = () => {
    if (history.length === 0) return;
    if (histIndex === null) setHistStash(draft);
    const i =
      histIndex === null ? history.length - 1 : Math.max(0, histIndex - 1);
    setHistIndex(i);
    setDraftCaretEnd(history[i]);
  };
  const recallNewer = () => {
    if (histIndex === null) return;
    if (histIndex < history.length - 1) {
      const i = histIndex + 1;
      setHistIndex(i);
      setDraftCaretEnd(history[i]);
    } else {
      setHistIndex(null);
      setDraftCaretEnd(histStash);
    }
  };

  // Auto-grow the textarea with its content up to ~10 lines, then scroll. Done
  // in JS (not CSS `field-sizing`) so growth is reliable across every webview we
  // ship on — WebView2, WKWebView, WebKitGTK — not only the ones with the new
  // CSS property.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize on draft change
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

  // `@file` mentions: list the worktree's tracked files (or the repo's, before a
  // session exists). Only fetched once a mention is being typed.
  const baseDir = session?.worktreePath ?? repoPath;
  const tracked = useTrackedFiles(baseDir, mention !== null && !!baseDir);
  const matches = useMemo(() => {
    if (!mention) return [];
    const all = tracked.data ?? [];
    const q = mention.query.toLowerCase();
    const hits = q ? all.filter((f) => f.toLowerCase().includes(q)) : all;
    return hits.slice(0, MAX_MENTIONS);
  }, [mention, tracked.data]);

  // `/` menu: built-ins + the SELECTED agent's discovered commands AND skills
  // (project + global, incl. the canonical `.agents/skills`) + the user's custom
  // commands (Settings → Slash commands). Discovery is fetched lazily once the
  // draft is a slash invocation, keyed on the repo ROOT (not the worktree) so it
  // stays cached across the session's worktree transition, and on the agent
  // (each CLI reads different dirs).
  const settings = useSettings();
  const customCommands = settings.data?.customCommands;
  const discovered = useAgentCommands(
    repoPath,
    agent,
    draft.startsWith("/") && !!repoPath,
  );
  const commands = useMemo(
    () => mergeCommands(discovered.data ?? [], customCommands ?? [], agent),
    [discovered.data, customCommands, agent],
  );
  // Show the full set (scrollable) — no narrowing required to browse.
  const slashMatches = useMemo(
    () => (slash ? filterCommands(commands, slash.query) : []),
    [slash, commands],
  );

  const clearDraft = () => {
    setDraft("");
    setMention(null);
    setSlash(null);
    setHistIndex(null);
  };

  const dispatch = (text: string) => {
    if (session) send(session.id, text);
    else start(repoPath, text, startModel, startAgent, startEffort);
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || running || creating) return;
    // Expand a known `/command` client-side (no CLI parses `/cmd` headless), so
    // the agent and the transcript see the final prompt. An unknown command
    // falls through and is sent literally.
    const invocation = parseSlashInvocation(text);
    if (invocation) {
      const cmd = findCommand(commands, invocation.name);
      if (cmd?.action === "clear") {
        clearDraft();
        return;
      }
      if (cmd) {
        dispatch(buildPrompt(cmd, invocation.args));
        clearDraft();
        return;
      }
    }
    dispatch(text);
    clearDraft();
  };

  // Recompute the active mention from the text up to the caret: an `@` at the
  // start or after whitespace, followed by the (space-free) query.
  const syncMention = (value: string, caret: number) => {
    const m = value.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/);
    if (m) {
      setMention({ query: m[1], start: caret - m[1].length - 1 });
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  };

  // The slash menu only opens at the very start of the draft, before any space
  // (it autocompletes the command NAME — arguments come after). Once a space is
  // typed the menu closes and the args phase begins.
  const syncSlash = (value: string, caret: number) => {
    const m = value.slice(0, caret).match(/^\/([a-zA-Z0-9][\w-]*)?$/);
    if (m) {
      setSlash({ query: m[1] ?? "" });
      setSlashIndex(0);
    } else {
      setSlash(null);
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const caret = e.target.selectionStart ?? value.length;
    setDraft(value);
    setHistIndex(null); // typing detaches from history browsing
    syncMention(value, caret);
    syncSlash(value, caret);
  };

  const insertMention = (path: string) => {
    const ta = ref.current;
    if (!mention || !ta) return;
    const before = draft.slice(0, mention.start);
    // Replace the whole `@query` token, not just up to the caret, and only add a
    // trailing space if there isn't one already (no double space mid-sentence).
    const rest = draft.slice(mention.start + 1 + mention.query.length);
    const sep = rest.startsWith(" ") ? "" : " ";
    setDraft(`${before}@${path}${sep}${rest}`);
    setMention(null);
    const pos = before.length + 1 + path.length + sep.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  // Picking a command from the `/` menu. Actions (e.g. /clear) run immediately;
  // prompt commands complete the name with a trailing space so the user can
  // type arguments, then Enter expands and sends.
  const selectSlash = (cmd: SlashCommand) => {
    if (cmd.action === "clear") {
      clearDraft();
      requestAnimationFrame(() => ref.current?.focus());
      return;
    }
    setSlash(null);
    setDraftCaretEnd(`/${cmd.name} `);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // While the `/` menu is open it owns Up/Down/Enter/Tab/Esc (when there are
    // matches), so Enter completes a command instead of sending. With no
    // matches, Enter falls through and sends the literal text.
    if (slash) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
      if (slashMatches.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashIndex((i) => (i + 1) % slashMatches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIndex(
            (i) => (i - 1 + slashMatches.length) % slashMatches.length,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectSlash(slashMatches[slashIndex]);
          return;
        }
      } else if (e.key === "Tab") {
        e.preventDefault(); // nothing to complete
        return;
      }
    }
    // While a mention is being typed it owns Up/Down/Enter/Tab/Esc, so Enter
    // never submits half-typed `@text` (even when nothing matches yet).
    if (mention) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (matches.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % matches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + matches.length) % matches.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(matches[mentionIndex]);
          return;
        }
      } else if (e.key === "Enter" || e.key === "Tab") {
        // Mention active but nothing matches: dismiss it, don't send.
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    // Terminal-style history: recall previous prompts with Up/Down — but only
    // when the caret is on the first/last line, so multi-line editing still
    // moves the caret normally.
    if (!mention && !slash && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const ta = ref.current;
      const collapsed = ta?.selectionStart === ta?.selectionEnd;
      const start = ta?.selectionStart ?? 0;
      if (
        e.key === "ArrowUp" &&
        history.length > 0 &&
        collapsed &&
        !draft.slice(0, start).includes("\n")
      ) {
        e.preventDefault();
        recallOlder();
        return;
      }
      if (
        e.key === "ArrowDown" &&
        histIndex !== null &&
        collapsed &&
        !draft.slice(start).includes("\n")
      ) {
        e.preventDefault();
        recallNewer();
        return;
      }
    }
    // Enter sends; Shift+Enter is a newline. Ignore IME composition commits.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {examples && draft.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setDraft(ex)}
              className="border px-2 py-1 text-[11px] text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        {mention && (
          <MentionList
            matches={matches}
            index={mentionIndex}
            loading={tracked.isPending}
            query={mention.query}
            onPick={insertMention}
            onHover={setMentionIndex}
          />
        )}
        {slash && (
          <SlashList
            matches={slashMatches}
            index={slashIndex}
            loading={discovered.isPending && draft.startsWith("/")}
            query={slash.query}
            onPick={selectSlash}
            onHover={setSlashIndex}
          />
        )}
        <div className="flex flex-col gap-2 border border-input bg-transparent p-3 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 dark:bg-input/30">
          <textarea
            ref={ref}
            autoFocus={autoFocus}
            value={draft}
            onChange={onChange}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label={
              session ? "Reply to the agent" : "Describe a task for the agent"
            }
            aria-autocomplete="list"
            aria-expanded={mention !== null || slash !== null}
            aria-controls={
              mention
                ? "session-mention-list"
                : slash
                  ? "session-slash-list"
                  : undefined
            }
            aria-activedescendant={
              mention && matches.length > 0
                ? `session-mention-${mentionIndex}`
                : slash && slashMatches.length > 0
                  ? `session-slash-${slashIndex}`
                  : undefined
            }
            placeholder={
              session
                ? "Reply to the agent…  (@ file, / command)"
                : "Describe a task for the agent…  (@ file, / command)"
            }
            className="max-h-40 min-h-9 w-full resize-none overflow-y-auto bg-transparent text-xs leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-2 border-t pt-2">
            {!session && (
              <AgentPicker
                value={startAgent}
                onChange={(a) => {
                  setStartAgent(a);
                  setStartModel(""); // model lists differ between agents
                }}
              />
            )}
            <ModelPicker value={model} onChange={onModel} models={models} />
            <EffortPicker value={effort} onChange={onEffort} />
            <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
              ↵ send · ⇧↵ newline
            </span>
            <AnimatePresence mode="wait" initial={false}>
              {running ? (
                <m.div
                  key="stop"
                  className="ml-auto"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={quickTransition}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => session && cancel(session.id)}
                  >
                    <StopIcon weight="fill" />
                    Stop
                  </Button>
                </m.div>
              ) : (
                <m.div
                  key="send"
                  className="ml-auto"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={quickTransition}
                >
                  <Button
                    size="sm"
                    className="min-w-20"
                    disabled={!canSubmit}
                    onClick={submit}
                  >
                    {creating && !session ? "Starting…" : "Send"}
                  </Button>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function MentionList({
  matches,
  index,
  loading,
  query,
  onPick,
  onHover,
}: {
  matches: string[];
  index: number;
  loading: boolean;
  query: string;
  onPick: (path: string) => void;
  onHover: (i: number) => void;
}) {
  return (
    <div
      id="session-mention-list"
      role="listbox"
      aria-label="Repository files"
      className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-full overflow-y-auto border bg-popover shadow-md ring-1 ring-foreground/10"
    >
      {matches.length === 0 ? (
        <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
          {loading ? "Loading files…" : `No files match “${query}”.`}
        </p>
      ) : (
        matches.map((f, i) => {
          const slash = f.lastIndexOf("/");
          const dir = slash >= 0 ? f.slice(0, slash + 1) : "";
          const name = slash >= 0 ? f.slice(slash + 1) : f;
          return (
            <button
              key={f}
              id={`session-mention-${i}`}
              role="option"
              aria-selected={i === index}
              type="button"
              // mousedown (not click) so the textarea doesn't blur before insert
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(f);
              }}
              onMouseMove={() => onHover(i)}
              className={cn(
                "flex w-full min-w-0 items-baseline gap-1.5 px-2.5 py-1.5 text-left text-xs",
                i === index
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/60",
              )}
            >
              <span className="truncate font-medium">{name}</span>
              {dir && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {dir}
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}

/** The `/command` autocomplete popover. Mirrors MentionList: a keyboard-driven
 *  listbox above the composer, mouse hover/select via mousedown (so the textarea
 *  keeps focus). Repo/custom commands carry a small source badge. */
function SlashList({
  matches,
  index,
  loading,
  query,
  onPick,
  onHover,
}: {
  matches: SlashCommand[];
  index: number;
  loading: boolean;
  query: string;
  onPick: (cmd: SlashCommand) => void;
  onHover: (i: number) => void;
}) {
  // Keep the keyboard-highlighted row visible as you arrow through the full,
  // un-narrowed (scrollable) list.
  useEffect(() => {
    document
      .getElementById(`session-slash-${index}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div
      id="session-slash-list"
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-full overflow-y-auto border bg-popover shadow-md ring-1 ring-foreground/10"
    >
      {matches.length === 0 ? (
        <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
          {loading ? "Loading…" : `No commands or skills match “/${query}”.`}
        </p>
      ) : (
        matches.map((c, i) => {
          // One small right-aligned tag: skills and native CLI commands stand
          // out, then custom, then global scope. Project-scoped agent commands
          // get none (the default).
          const badge =
            c.kind === "skill"
              ? "skill"
              : c.kind === "native"
                ? "built-in"
                : c.source === "custom"
                  ? "custom"
                  : c.scope === "global"
                    ? "global"
                    : null;
          return (
            <button
              key={`${c.kind}:${c.name}`}
              id={`session-slash-${i}`}
              role="option"
              aria-selected={i === index}
              type="button"
              // mousedown (not click) so the textarea doesn't blur before select
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(c);
              }}
              onMouseMove={() => onHover(i)}
              className={cn(
                "flex w-full min-w-0 items-baseline gap-1.5 px-2.5 py-1.5 text-left text-xs",
                i === index
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/60",
              )}
            >
              <span className="shrink-0 font-medium">/{c.name}</span>
              {c.argumentHint && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {c.argumentHint}
                </span>
              )}
              <span className="truncate text-[11px] text-muted-foreground">
                {c.description}
              </span>
              {badge && (
                <span
                  className={cn(
                    "ml-auto shrink-0 text-[10px] uppercase tracking-wide",
                    c.kind === "skill"
                      ? "text-primary/80"
                      : "text-muted-foreground/70",
                  )}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}

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
      <SelectContent>
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
 *  gauge icon marks it as effort so the collapsed value isn't mistaken for a model.
 *  Reused by the read-only Plan composer. */
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

/** Picks the CLI for a NEW session (fixed once it starts). Every agent honors the
 *  isolation setting — host (worktree-confined, soft) or container — provided that
 *  agent is baked into the image (Codex is container-only). Also reused by the
 *  read-only Plan composer (which needs a repo-aware CLI agent). */
export function AgentPicker({
  value,
  onChange,
}: {
  value: "claude" | "codex" | "copilot" | "opencode";
  onChange: (a: "claude" | "codex" | "copilot" | "opencode") => void;
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
