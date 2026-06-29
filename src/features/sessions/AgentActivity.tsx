import {
  CaretDownIcon,
  CaretRightIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  GlobeIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TerminalWindowIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { type ComponentType, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { AgentActivityStep, AgentToolKind } from "@/lib/ai/agent";

type GlyphIcon = ComponentType<{ className?: string }>;

/** Per-category icon + verb. `file` marks targets that are repo paths, so they're
 *  shown relative to the run's base dir (commands / URLs / queries stay verbatim). */
const META: Record<
  AgentToolKind,
  { icon: GlyphIcon; verb: string; file?: boolean }
> = {
  read: { icon: FileTextIcon, verb: "Read", file: true },
  search: { icon: MagnifyingGlassIcon, verb: "Searched" },
  list: { icon: FolderOpenIcon, verb: "Listed", file: true },
  edit: { icon: PencilSimpleIcon, verb: "Edited", file: true },
  write: { icon: FilePlusIcon, verb: "Wrote", file: true },
  run: { icon: TerminalWindowIcon, verb: "Ran" },
  "web-fetch": { icon: GlobeIcon, verb: "Fetched" },
  "web-search": { icon: GlobeIcon, verb: "Searched the web" },
  task: { icon: SparkleIcon, verb: "Delegated" },
  other: { icon: WrenchIcon, verb: "Used" },
};

/** Show a repo path relative to the run's base dir (the worktree/repo root), so
 *  steps read `src/foo.ts`, not the absolute CLI path. Slash-insensitive. */
function relativize(target: string, baseDir?: string): string {
  if (!baseDir) return target;
  const t = target.replace(/\\/g, "/");
  const b = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return t.toLowerCase().startsWith(`${b.toLowerCase()}/`)
    ? t.slice(b.length + 1)
    : target;
}

function StepRow({
  step,
  spinning,
  baseDir,
}: {
  step: AgentActivityStep;
  spinning: boolean;
  baseDir?: string;
}) {
  const meta = META[step.tool] ?? META.other;
  const Glyph = meta.icon;
  const shown =
    step.target && meta.file ? relativize(step.target, baseDir) : step.target;
  return (
    <li className="flex items-center gap-1.5 text-[11px] leading-relaxed">
      {spinning ? (
        <Spinner className="size-3 shrink-0 text-primary" />
      ) : (
        <Glyph className="size-3.5 shrink-0 text-muted-foreground/70" />
      )}
      <span className="shrink-0 text-muted-foreground">{meta.verb}</span>
      {shown && (
        <span
          className="min-w-0 truncate font-mono text-foreground/75"
          title={step.target ?? undefined}
        >
          {shown}
        </span>
      )}
    </li>
  );
}

/**
 * A calm, persistent timeline of the steps an agent took — each tool call with
 * what it acted on (file path / command / URL / query). Shared by the session,
 * plan, and research surfaces. While the turn runs it shows the steps live (the
 * latest one spins); once it finishes it collapses to a one-line "N steps" you
 * can expand, so the narration / result stays the focus.
 */
export function AgentActivity({
  steps,
  running,
  baseDir,
}: {
  steps: AgentActivityStep[];
  /** The turn is still streaming — show the steps live + spin the latest. */
  running?: boolean;
  /** Repo/worktree root, used to show file targets as relative paths. */
  baseDir?: string;
}) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const list = (
    <ul className="flex flex-col gap-0.5 border-l border-border/60 pl-2.5">
      {steps.map((step, i) => (
        <StepRow
          // Steps are append-only within a turn, so the index is a stable key.
          key={i}
          step={step}
          spinning={Boolean(running) && i === steps.length - 1}
          baseDir={baseDir}
        />
      ))}
    </ul>
  );

  // Live: always expanded so the user watches progress as it happens.
  if (running) return list;

  // Done: a quiet, expandable summary so finished steps don't crowd the result.
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-xs focus-visible:outline-1 focus-visible:outline-ring"
      >
        {open ? (
          <CaretDownIcon className="size-3" />
        ) : (
          <CaretRightIcon className="size-3" />
        )}
        {steps.length} step{steps.length === 1 ? "" : "s"}
      </button>
      {open && list}
    </div>
  );
}
