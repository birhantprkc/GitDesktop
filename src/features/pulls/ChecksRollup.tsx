import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { PrCheckOut } from "@/lib/git/types";
import { useJobLogs, useRunFailedLogs } from "@/lib/github/actions";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { cn } from "@/lib/utils";

/**
 * Tone + glyph for a CI check, so pass/fail isn't conveyed by color alone.
 * Moved here from RemotePrView — it's checks-specific and only this component
 * uses it now.
 */
function checkPresentation(status: string): {
  tone: string;
  Icon: typeof CheckCircleIcon;
  label: string;
  /** Coarse bucket for the rollup summary + failures-first sort. */
  bucket: "passed" | "failed" | "pending";
} {
  const s = status.toUpperCase();
  if (s === "SUCCESS") {
    return {
      tone: "text-success",
      Icon: CheckCircleIcon,
      label: "passed",
      bucket: "passed",
    };
  }
  if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(s)) {
    return {
      tone: "text-destructive",
      Icon: XCircleIcon,
      label: "failed",
      bucket: "failed",
    };
  }
  return {
    tone: "text-warning",
    Icon: CircleIcon,
    label: "pending",
    bucket: "pending",
  };
}

/** "1m 12s" elapsed between two ISO timestamps (mirrors RunDetailView's helper).
 *  Returns "" when either timestamp is missing/unparseable. */
function duration(start?: string, end?: string): string {
  if (!start || !end) return "";
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "";
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Sets a hover title only when the name is actually clipped by `truncate`;
 *  mirrors the only-when-clipped pattern in CommitsList/WorktreesDialog. */
const clipTitle = (value: string) => (e: MouseEvent<HTMLElement>) => {
  const el = e.currentTarget;
  el.title = el.scrollWidth > el.clientWidth ? value : "";
};

/** A GitHub-Actions check's inline log tail (Skeleton → log tail), matching
 *  RunDetailView's `<pre>` idiom. Only mounted while the row is expanded, so the
 *  query fires lazily; the `enabled` gate carries the row-expanded state. */
function CheckLogTail({
  repoPath,
  check,
}: {
  repoPath: string;
  check: PrCheckOut;
}) {
  // A job id gets the per-job log; a run without a parsed job id falls back to
  // the run-wide failed-step logs (same as the Actions panel's failed-logs view).
  // NOTE: run/job ids are kept as *strings* on PrCheckOut (they can exceed JS's
  // safe-integer range), but the shared Actions log hooks (useJobLogs/
  // useRunFailedLogs → forge_ci_*_logs) still take numeric ids, so we narrow here.
  // Safe today — real GitHub/GitLab ids are ~1e10, far below 2^53 — but a
  // follow-up should thread these as strings end-to-end through the Actions log
  // path (commands + Actions panel + MCP callers) to make it precision-safe.
  const jobId = check.jobId ? Number(check.jobId) : null;
  const runId = check.runId ? Number(check.runId) : null;
  const jobLogs = useJobLogs(
    repoPath,
    jobId !== null ? { id: jobId } : null,
    true,
  );
  const runLogs = useRunFailedLogs(repoPath, runId, jobId === null);
  const logs = jobId !== null ? jobLogs : runLogs;

  if (logs.isPending) {
    return (
      <div className="mt-1.5 space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }
  if (logs.isError) {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
        Couldn't load logs.
        {check.detailsUrl && (
          <button
            type="button"
            onClick={() => check.detailsUrl && openUrl(check.detailsUrl)}
            className="inline-flex cursor-pointer items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
          >
            <ArrowSquareOutIcon className="size-3" />
            Open full run
          </button>
        )}
      </p>
    );
  }
  return (
    <pre className="mt-1.5 max-h-72 overflow-auto border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
      {logs.data?.trim() || "No logs available."}
    </pre>
  );
}

/** One check row: state icon + name + duration + trailing affordance. GitHub
 *  Actions checks (a parsed run id) peek their log inline; external checks link
 *  out; URL-less checks show just name + status. */
function CheckRow({
  repoPath,
  check,
  rowId,
}: {
  repoPath: string;
  check: PrCheckOut;
  /** Unique row identity (the sorted index) for `data-row` + roving focus —
   *  GitHub allows two checks with the same `name`, so name can't be the id. */
  rowId: string;
}) {
  const { tone, Icon, label } = checkPresentation(check.status);
  const elapsed = duration(check.startedAt, check.completedAt);
  // "Actions check" = a details URL we parsed a run id out of. A job id peeks
  // one job's log; a run id without a job falls back to the run's failed logs.
  const isActionsCheck = Boolean(check.runId);
  const [logsOpen, setLogsOpen] = useState(false);

  // The row's shared inner content (icon + name + duration). Rendered inside a
  // focusable button for interactive rows (Actions → toggles logs; else the
  // details link opens) and a plain div for a URL-less check.
  const inner = (
    <>
      {isActionsCheck &&
        (logsOpen ? (
          <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
        ))}
      <Icon
        className={cn("size-3.5 shrink-0", tone)}
        aria-label={label}
        weight="fill"
      />
      <span
        className="min-w-0 flex-1 truncate font-medium"
        onMouseEnter={clipTitle(check.name)}
      >
        {check.name}
      </span>
      {elapsed && (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {elapsed}
        </span>
      )}
    </>
  );

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center hover:bg-muted/60">
        {isActionsCheck ? (
          // The whole header is the disclosure (mirrors RunDetailView's JobRow):
          // Enter/Space or click toggles the inline log; arrow-nav focuses it.
          <button
            type="button"
            data-row={rowId}
            onClick={() => setLogsOpen((v) => !v)}
            aria-expanded={logsOpen}
            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs"
          >
            {inner}
          </button>
        ) : check.detailsUrl ? (
          // An external check: the whole row opens its details URL.
          <button
            type="button"
            data-row={rowId}
            onClick={() => check.detailsUrl && openUrl(check.detailsUrl)}
            title="Open this check"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs"
          >
            {inner}
            <ArrowSquareOutIcon className="size-3 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          // No details URL: just icon + name + status, nothing to activate.
          <div
            data-row={rowId}
            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-xs"
          >
            {inner}
          </div>
        )}
        {isActionsCheck && check.detailsUrl && (
          <button
            type="button"
            onClick={() => check.detailsUrl && openUrl(check.detailsUrl)}
            title="Open the full run"
            className="mr-2 inline-flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <ArrowSquareOutIcon className="size-3" />
            Open full run
          </button>
        )}
      </div>
      {isActionsCheck && logsOpen && (
        <div className="px-3 pb-2 pl-10">
          <CheckLogTail repoPath={repoPath} check={check} />
        </div>
      )}
    </div>
  );
}

/**
 * The PR's CI checks, as a disclosure rollup: a summary line
 * (`✓ N passed · ✕ M failed · ● K pending`, each count with its own icon + word
 * so meaning is never color-alone) that expands to a keyboard-navigable,
 * height-capped list with failures first. Checks with a fetchable run/job (GitHub
 * Actions, GitLab pipeline jobs) peek their log inline; external checks (Bitbucket
 * build statuses, etc.) link out. Auto-expanded when anything failed.
 *
 * Renders nothing when there are no checks (a PR whose provider reports none, or a
 * GitHub PR with no CI) — RemotePrView also guards, but this stays defensive.
 */
export function ChecksRollup({
  checks,
  repoPath,
}: {
  checks: PrCheckOut[];
  repoPath: string;
}) {
  const passed = checks.filter(
    (c) => checkPresentation(c.status).bucket === "passed",
  ).length;
  const failed = checks.filter(
    (c) => checkPresentation(c.status).bucket === "failed",
  ).length;
  const pending = checks.filter(
    (c) => checkPresentation(c.status).bucket === "pending",
  ).length;

  // Auto-expand on any failure — a failing PR should show what failed without a
  // click. Otherwise collapsed by default.
  const [open, setOpen] = useState(failed > 0);
  // …and re-open when failures FIRST appear after mount: usePrDetails refetches
  // on window focus (no remount), so a PR opened while CI is pending would
  // otherwise stay collapsed when a check later fails. Fire only on the 0→>0
  // transition — never force-open while failing, so a manual collapse sticks.
  const prevFailed = useRef(failed);
  useEffect(() => {
    if (prevFailed.current === 0 && failed > 0) setOpen(true);
    prevFailed.current = failed;
  }, [failed]);

  // Failures first, then pending, then passed; stable within a bucket.
  const bucketRank = { failed: 0, pending: 1, passed: 2 } as const;
  const sorted = [...checks].sort(
    (a, b) =>
      bucketRank[checkPresentation(a.status).bucket] -
      bucketRank[checkPresentation(b.status).bucket],
  );

  // Roving focus: the "active" row is whichever row element currently holds DOM
  // focus, keyed by `data-row` = the row's sorted index (a check `name` isn't
  // unique — GitHub allows two same-named checks). ArrowUp/Down step from
  // wherever focus is; `listKeyboardNav` moves focus + scrolls into view; the
  // rows are their own focusable buttons, so there's no separate selection state.
  const rowId = (i: number) => String(i);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focusedId =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.getAttribute("data-row")
        : null;
    const focusedIdx = focusedId === null ? -1 : Number(focusedId);
    const activeIndex = Number.isInteger(focusedIdx) ? focusedIdx : -1;
    listKeyboardNav({
      items: sorted,
      activeIndex,
      // No selection model — focus movement + scroll-into-view is all done by
      // `rowKey` below (the rows are their own focusable buttons). Identity is
      // the sorted index (`indexOf` on the distinct array element), not the
      // check name, so two same-named checks stay individually focusable.
      onActivate: () => undefined,
      rowKey: (c) => rowId(sorted.indexOf(c)),
    })(e);
  };

  if (checks.length === 0) return null;

  const summary: {
    key: string;
    count: number;
    Icon: typeof CheckCircleIcon;
    tone: string;
    word: string;
  }[] = [
    {
      key: "passed",
      count: passed,
      Icon: CheckCircleIcon,
      tone: "text-success",
      word: "passed",
    },
    {
      key: "failed",
      count: failed,
      Icon: XCircleIcon,
      tone: "text-destructive",
      word: "failed",
    },
    {
      key: "pending",
      count: pending,
      Icon: CircleIcon,
      tone: "text-warning",
      word: "pending",
    },
  ].filter((s) => s.count > 0);

  return (
    <div className="text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <CaretDownIcon className="size-3 shrink-0" />
        ) : (
          <CaretRightIcon className="size-3 shrink-0" />
        )}
        <span className="flex items-center gap-x-2.5">
          {summary.map((s, i) => (
            <span key={s.key} className="flex items-center gap-x-2.5">
              {i > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
              )}
              <span className={cn("flex items-center gap-1", s.tone)}>
                <s.Icon className="size-3 shrink-0" weight="fill" aria-hidden />
                {s.count} {s.word}
              </span>
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div
          className="mt-1.5 max-h-64 overflow-y-auto border"
          onKeyDown={onKeyDown}
        >
          {sorted.map((c, i) => (
            // Key + data-row on the sorted index — `c.name` isn't unique (GitHub
            // allows two checks with the same name), which would collide keys and
            // make the second row unfocusable.
            <CheckRow
              key={rowId(i)}
              rowId={rowId(i)}
              repoPath={repoPath}
              check={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}
