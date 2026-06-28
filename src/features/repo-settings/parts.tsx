import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useActiveGhHost } from "@/lib/git/host";
import { cn } from "@/lib/utils";

/**
 * The shared loading / error / empty / list shell for the repo-settings async
 * lists (secrets, collaborators, rulesets, webhooks). Renders skeletons while
 * loading, a destructive error card (optionally with a `gh auth refresh` scope
 * hint or a custom hint) on error, a dashed placeholder when empty, else the rows.
 * Extracting it keeps these sections consistent and stops the error/scope copy
 * from drifting per-section.
 */
export function AsyncListBody({
  loading,
  error,
  empty,
  emptyLabel,
  children,
  skeletonClassName = "h-10 w-full",
  errorTitle = "Couldn't load these.",
  errorScope,
  errorHint,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyLabel: string;
  children: ReactNode;
  /** Skeleton size, sized to roughly match each section's row height. */
  skeletonClassName?: string;
  errorTitle?: string;
  /** Renders the standard "needs a broader scope — run `gh auth refresh -s <scope>`"
   *  note in the error card. */
  errorScope?: string;
  /** A custom hint node in the error card, for sections without a single scope. */
  errorHint?: ReactNode;
}) {
  const host = useActiveGhHost();
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className={skeletonClassName} />
        <Skeleton className={skeletonClassName} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
        <p className="font-medium text-destructive">{errorTitle}</p>
        {error instanceof Error && (
          <p className="mt-1 text-muted-foreground">{error.message}</p>
        )}
        {errorScope && (
          <p className="mt-2 text-muted-foreground">
            If this is a permissions error, your GitHub sign-in may need a
            broader scope — run{" "}
            <span className="font-mono">
              gh auth refresh -h {host} -s {errorScope}
            </span>{" "}
            and reopen this dialog.
          </p>
        )}
        {errorHint && (
          <div className="mt-2 text-muted-foreground">{errorHint}</div>
        )}
      </div>
    );
  }
  if (empty) {
    return (
      <p className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  return <div className="space-y-2">{children}</div>;
}

/**
 * The confirm half of an inline confirm-delete affordance: a `Cancel` button and
 * a (usually destructive) action button with a pending spinner, optionally
 * preceded by a prompt. The parent owns the `confirming` state and renders this in
 * the confirming branch in place of its normal trigger — so the reset-on-cancel /
 * on-success and the row layout stay with the parent, but the repeated button
 * markup lives in one place.
 */
export function InlineConfirm({
  prompt,
  promptClassName,
  cancelLabel = "Cancel",
  cancelVariant = "ghost",
  actLabel,
  actVariant = "destructive",
  pending = false,
  onCancel,
  onAct,
}: {
  prompt?: ReactNode;
  /** e.g. `mr-auto` to push the buttons to the right in a footer layout. */
  promptClassName?: string;
  cancelLabel?: ReactNode;
  cancelVariant?: "ghost" | "outline";
  actLabel: ReactNode;
  actVariant?: "destructive" | "default";
  pending?: boolean;
  onCancel: () => void;
  onAct: () => void;
}) {
  return (
    <>
      {prompt != null && (
        <span className={cn("text-muted-foreground", promptClassName)}>
          {prompt}
        </span>
      )}
      <Button size="sm" variant={cancelVariant} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button size="sm" variant={actVariant} disabled={pending} onClick={onAct}>
        {pending && <Spinner data-icon="inline-start" />}
        {actLabel}
      </Button>
    </>
  );
}
