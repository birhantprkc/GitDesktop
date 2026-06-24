import {
  ArrowsClockwiseIcon,
  ChatCircleDotsIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PlanQuestion } from "@/lib/ai/prompt";
import { cn } from "@/lib/utils";

/** Sentinel for the "Other — write your own" choice. A reserved token (not a
 *  leading space, which is fragile) so it can never collide with a real option. */
const OTHER = "__OTHER__";

/**
 * The plan's open questions, rendered as an answerable panel modeled on Claude
 * Code's AskUserQuestion: each question offers the model's suggested answers as a
 * single-select group (native radios, so arrow keys navigate and select for free
 * and it's screen-reader correct) plus an "Other" free-text. Answer what you can,
 * then **Refine plan** re-runs the planner with your decisions folded in so it
 * resolves the ambiguity — closing the loop before the spec is implemented.
 */
export function PlanQuestions({
  questions,
  generating,
  onRefine,
}: {
  questions: PlanQuestion[];
  generating: boolean;
  onRefine: (decisions: { question: string; answer: string }[]) => void;
}) {
  const groupId = useId();
  // Per-question state: the picked option (or the OTHER sentinel), and the
  // free-text the user typed for an "Other" answer. Keyed by question index.
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});

  const answerFor = (i: number): string => {
    const choice = picked[i];
    if (choice === undefined) return "";
    return choice === OTHER ? (custom[i] ?? "").trim() : choice;
  };

  const decisions = questions.map((q, i) => ({
    question: q.question,
    answer: answerFor(i),
  }));
  const answeredCount = decisions.filter((d) => d.answer).length;

  return (
    <section
      aria-label="Open questions"
      className="mt-4 border bg-card text-card-foreground"
    >
      <header className="flex items-start gap-2.5 border-b px-3.5 py-3">
        <ChatCircleDotsIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-xs font-medium">
            A few questions to sharpen the plan
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            The planner wasn't sure on a few decisions. Answer what you can —
            pick a suggestion or write your own — and it'll re-plan with your
            choices.
          </p>
        </div>
      </header>

      <div className="flex flex-col divide-y">
        {questions.map((q, i) => (
          <QuestionBlock
            key={q.question}
            name={`${groupId}-q${i}`}
            index={i}
            question={q}
            picked={picked[i]}
            custom={custom[i] ?? ""}
            onPick={(v) => setPicked((p) => ({ ...p, [i]: v }))}
            onCustom={(v) => {
              setCustom((c) => ({ ...c, [i]: v }));
              // Typing in the free-text box implies the "Other" choice, even for
              // a question that listed no suggestions.
              setPicked((p) => ({ ...p, [i]: OTHER }));
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 border-t px-3.5 py-3">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {answeredCount} of {questions.length} answered
        </span>
        <Button
          size="sm"
          className="ml-auto"
          disabled={generating || answeredCount === 0}
          onClick={() => onRefine(decisions)}
          title="Re-run the planner with your answers folded in"
        >
          <ArrowsClockwiseIcon data-icon="inline-start" />
          Refine plan
        </Button>
      </div>
    </section>
  );
}

/** One question: its suggested answers as a single-select radio group, plus an
 *  "Other" free-text. Self-contained so it can own the input ref and focus it
 *  (without scrolling) the moment the user switches to "Other". */
function QuestionBlock({
  name,
  index,
  question,
  picked,
  custom,
  onPick,
  onCustom,
}: {
  name: string;
  index: number;
  question: PlanQuestion;
  picked: string | undefined;
  custom: string;
  onPick: (value: string) => void;
  onCustom: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = `${name}-label`;
  const isOther = picked === OTHER;
  const showInput = isOther || question.options.length === 0;

  // Focus the free-text box when the user switches to "Other" — WITHOUT scrolling
  // any ancestor (preventScroll). A plain autofocus scrolls the input into view,
  // which yanked the whole page down and left a gap.
  useEffect(() => {
    if (isOther) inputRef.current?.focus({ preventScroll: true });
  }, [isOther]);

  return (
    <div className="px-3.5 pt-4 pb-3.5">
      <p id={labelId} className="mb-2.5 text-xs leading-relaxed font-medium">
        <span className="text-muted-foreground">{index + 1}.</span>{" "}
        {question.question}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex flex-col gap-1.5"
      >
        {question.options.map((opt, oi) => (
          <OptionRow
            key={opt}
            name={name}
            label={opt}
            recommended={oi === 0 && question.options.length > 1}
            checked={picked === opt}
            onSelect={() => onPick(opt)}
          />
        ))}
        <OptionRow
          name={name}
          label="Other — write your own"
          checked={isOther}
          onSelect={() => onPick(OTHER)}
        />
        {showInput && (
          <input
            ref={inputRef}
            type="text"
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
            placeholder="Your answer…"
            aria-label={`Your answer to: ${question.question}`}
            className="mt-1 w-full border border-input bg-transparent px-3 py-2 text-xs leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 placeholder:text-muted-foreground dark:bg-input/30"
          />
        )}
      </div>
    </div>
  );
}

/** One selectable answer: a visually-hidden native radio (keeps the group's
 *  arrow-key navigation + a11y) with a state-styled card label. */
function OptionRow({
  name,
  label,
  recommended,
  checked,
  onSelect,
}: {
  name: string;
  label: string;
  recommended?: boolean;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        // `relative` keeps the sr-only radio positioned WITHIN this row — without
        // it, focusing the radio scrolls the page to wherever the absolute element
        // lands (the jump/expansion on click).
        "relative flex cursor-pointer items-start gap-2.5 border px-3 py-2 text-xs leading-relaxed transition-colors focus-within:ring-1 focus-within:ring-ring/50",
        checked
          ? "border-primary bg-primary/5"
          : "border-transparent bg-muted/40 hover:bg-muted",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <CheckCircleIcon
        weight="fill"
        className={cn(
          "mt-px size-3.5 shrink-0 transition-opacity",
          checked ? "text-primary opacity-100" : "opacity-0",
        )}
      />
      <span className="min-w-0">{label}</span>
      {recommended && (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          Recommended
        </span>
      )}
    </label>
  );
}
