import type { RewriteStep } from "@/lib/git/types";

/**
 * The interactive-rebase vocabulary for one unpushed commit. Mirrors
 * `git rebase -i`: **pick** keeps it, **reword** changes its message, **squash**
 * folds it into the commit below (older) combining messages, **fixup** folds it
 * in keeping the leader's message, **drop** removes it.
 */
export type RowAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface EditRow {
  hash: string;
  /** The commit's original subject — for display and fold hints. */
  subject: string;
  action: RowAction;
  /** The row's message — the user's edit, or the commit's full original message
   *  as the default. Used as the leader's part for a reword or a squash leader,
   *  and as a squash row's contribution; ignored for pick/fixup/drop. */
  message: string;
}

export interface RowView {
  /** Whether this row should render an editable message field. */
  showMessage: boolean;
  /** `into "<leader subject>"` for a squash/fixup row with a leader; else null. */
  foldInto: string | null;
}

export interface CompiledPlan {
  /** Oldest-first steps for `git_rewrite_commits`. */
  steps: RewriteStep[];
  /** How many commits the rewrite produces. */
  resultCount: number;
  /** Per-row display metadata, parallel to the input rows. */
  views: RowView[];
  /** The first blocking problem, or null when the plan is valid to apply. */
  error: string | null;
  /** Whether the plan differs from the no-op (original order, all picked). */
  changed: boolean;
}

const leads = (a: RowAction) => a === "pick" || a === "reword";

/**
 * Compiles Edit-history rows (newest-first display order) into the oldest-first
 * `RewriteStep[]` the replay engine runs, plus per-row view metadata and
 * validation.
 *
 * A squash/fixup row folds into its **leader** — the nearest kept pick/reword
 * row *below* it (older). Steps are built oldest-first; a fold appends its hash
 * to the leader's step in chronological order, so `cherry-pick` replays
 * leader-then-folds. A leader step's message encodes the vocabulary: omitted →
 * pick (cherry-pick keeps the message) or fixup (engine reuses the leader's via
 * `commit -C`); present → reword/squash (`commit -m`). Each row's `message`
 * supplies its own part of a combined squash message — including a *pick* leader
 * that receives a squash, which therefore shows an editable message too (so its
 * contribution isn't silently baked in invisibly).
 */
export function compilePlan(
  rows: EditRow[],
  originalHashes: string[],
): CompiledPlan {
  const n = rows.length;
  const views: RowView[] = rows.map((r) => ({
    showMessage: r.action === "reword" || r.action === "squash",
    foldInto: null,
  }));

  const steps: RewriteStep[] = [];
  const stepByLeader = new Map<number, RewriteStep>();
  const leaderHasSquash: boolean[] = rows.map(() => false);
  let currentLeader = -1;
  let error: string | null = null;

  // Walk oldest→newest (display bottom-up). Leaders create a step; folds attach
  // to the nearest leader below them and append their hash (chronological).
  for (let i = n - 1; i >= 0; i--) {
    const { action } = rows[i];
    if (action === "drop") continue;
    if (leads(action)) {
      currentLeader = i;
      const step: RewriteStep = { hashes: [rows[i].hash] };
      steps.push(step);
      stepByLeader.set(i, step);
    } else if (currentLeader === -1) {
      error ??= `"${rows[i].subject}" can't be ${
        action === "squash" ? "squashed" : "fixed up"
      } — there's no commit below it to merge into.`;
    } else {
      views[i].foldInto = `into "${rows[currentLeader].subject}"`;
      stepByLeader.get(currentLeader)?.hashes.push(rows[i].hash);
      if (action === "squash") leaderHasSquash[currentLeader] = true;
    }
  }

  // A pick leader that receives a squash also exposes its message — its full
  // body goes into the combined commit, so it must be visible and editable.
  for (let i = 0; i < n; i++) {
    if (rows[i].action === "pick" && leaderHasSquash[i]) {
      views[i].showMessage = true;
    }
  }

  // Resolve each leader step's message from its own part + its squash folds.
  const rowByHash = new Map(rows.map((r) => [r.hash, r]));
  for (const [leaderIdx, step] of stepByLeader) {
    const leader = rows[leaderIdx];
    const reworded = leader.action === "reword";
    const hasSquash = leaderHasSquash[leaderIdx];
    // Plain pick (cherry-pick keeps the message) or pick + fixups only (engine
    // `commit -C` reuses the leader's message): leave the step message undefined.
    if (!hasSquash && !reworded) continue;
    const parts = [leader.message];
    for (const h of step.hashes.slice(1)) {
      const r = rowByHash.get(h);
      if (r?.action === "squash") parts.push(r.message);
    }
    step.message = parts
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .join("\n\n");
  }

  // Validation (first blocker wins; a fold-without-leader error takes priority).
  if (!error && rows.every((r) => r.action === "drop")) {
    error = "Keep at least one commit — you can't drop them all.";
  }
  if (!error) {
    const blank = rows.find(
      (r) => r.action === "reword" && r.message.trim() === "",
    );
    if (blank) error = `Rewording "${blank.subject}" needs a commit message.`;
  }

  const reordered =
    rows.length !== originalHashes.length ||
    rows.some((r, i) => r.hash !== originalHashes[i]);
  const changed = reordered || rows.some((r) => r.action !== "pick");

  return { steps, resultCount: steps.length, views, error, changed };
}
