import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleNotchIcon,
  MinusCircleIcon,
  ProhibitIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { isRunActive } from "@/lib/github/actions";
import { cn } from "@/lib/utils";

/** Whether a completed conclusion counts as a failure (drives "Re-run failed"). */
export function isFailureConclusion(conclusion: string): boolean {
  return (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "startup_failure"
  );
}

/** Human label for a run/job/step's combined status + conclusion. */
export function statusLabel(status: string, conclusion: string): string {
  if (status !== "completed") {
    if (status === "in_progress") return "In progress";
    if (status === "waiting") return "Waiting";
    return "Queued";
  }
  switch (conclusion) {
    case "success":
      return "Succeeded";
    case "failure":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "startup_failure":
      return "Startup failure";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    case "action_required":
      return "Action required";
    case "neutral":
      return "Neutral";
    case "stale":
      return "Stale";
    default:
      return conclusion || "Completed";
  }
}

/**
 * Status glyph for a run, job, or step. Active items spin; completed ones show
 * a coloured pass/fail/neutral mark. `weight="bold"` keeps the dashed/notch
 * outlines legible.
 */
export function StatusIcon({
  status,
  conclusion,
  className,
}: {
  status: string;
  conclusion: string;
  className?: string;
}) {
  const base = cn("size-4 shrink-0", className);

  if (status !== "completed") {
    if (status === "in_progress") {
      return (
        <CircleNotchIcon
          weight="bold"
          className={cn(base, "animate-spin text-amber-500")}
        />
      );
    }
    return (
      <CircleDashedIcon
        weight="bold"
        className={cn(base, "text-muted-foreground")}
      />
    );
  }

  switch (conclusion) {
    case "success":
      return (
        <CheckCircleIcon
          weight="fill"
          className={cn(base, "text-green-600 dark:text-green-400")}
        />
      );
    case "failure":
    case "timed_out":
    case "startup_failure":
      return (
        <XCircleIcon
          weight="fill"
          className={cn(base, "text-red-600 dark:text-red-400")}
        />
      );
    case "action_required":
      return (
        <WarningIcon
          weight="fill"
          className={cn(base, "text-amber-600 dark:text-amber-400")}
        />
      );
    case "cancelled":
      return (
        <ProhibitIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
    case "skipped":
      return (
        <MinusCircleIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
    default:
      return (
        <CircleIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
  }
}

export { isRunActive };
