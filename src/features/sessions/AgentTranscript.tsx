import {
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
import type { ComponentType } from "react";
import { Markdown } from "@/components/ui/markdown";
import type { AgentToolKind, TranscriptSegment } from "@/lib/ai/agent";
import { AgentNarration } from "./AgentNarration";

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

/** One inline tool step in the transcript — a calm row (icon + verb + target)
 *  set slightly apart from the surrounding prose by a faint tint. */
function ToolStep({
  tool,
  target,
  baseDir,
}: {
  tool: AgentToolKind;
  target: string | null;
  baseDir?: string;
}) {
  const meta = META[tool] ?? META.other;
  const Glyph = meta.icon;
  const shown = target && meta.file ? relativize(target, baseDir) : target;
  return (
    <div className="flex items-center gap-1.5 bg-muted/40 px-2 py-1 text-[11px] leading-relaxed">
      <Glyph className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-muted-foreground">{meta.verb}</span>
      {shown && (
        <span
          className="min-w-0 truncate font-mono text-foreground/75"
          title={target ?? undefined}
        >
          {shown}
        </span>
      )}
    </div>
  );
}

/**
 * Renders an agent turn as one chronological transcript — streamed prose with the
 * tool steps interleaved exactly where they happened (text → tool → text), the
 * way Claude Code / the VS Code agent view read. Shared by the session, plan, and
 * research surfaces; `fileLinks` routes prose through {@link AgentNarration} (so
 * file paths open in the editor) for sessions/plans, or plain {@link Markdown} for
 * research reports (which cite web URLs and shouldn't bounce to an editor).
 */
export function AgentTranscript({
  segments,
  baseDir,
  fileLinks = true,
}: {
  segments: TranscriptSegment[];
  /** Repo/worktree root, used to show file targets + links as relative paths. */
  baseDir?: string;
  /** Render prose with clickable file paths (sessions/plans) vs plain markdown. */
  fileLinks?: boolean;
}) {
  if (segments.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          // Segments are append-only within a turn, so the index is a stable key.
          fileLinks ? (
            <AgentNarration key={i} text={seg.text} baseDir={baseDir ?? ""} />
          ) : (
            <Markdown key={i}>{seg.text}</Markdown>
          )
        ) : (
          <ToolStep
            key={i}
            tool={seg.tool}
            target={seg.target}
            baseDir={baseDir}
          />
        ),
      )}
    </div>
  );
}
