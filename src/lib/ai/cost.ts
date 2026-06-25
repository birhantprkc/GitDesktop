// Cost guardrails for multi-agent runs. We have no token pre-estimator, so the
// honest signal is what the user's PAST sessions actually cost — a mean over their
// recorded spend. Used to warn before a run that fans out N independently-billed
// agents (best-of-N today; pipelines/orchestration later), and to total a run's
// live spend. Pure functions — the caller passes the sessions in (no store import,
// so this stays in lib/).

/** A rough upfront estimate for a multi-agent run, from historical spend. */
export interface RunCostEstimate {
  /** Mean total $ of a past session that recorded a cost; null if no samples. */
  perSession: number | null;
  /** How many past sessions the mean is based on. */
  sampleSize: number;
}

/** The shape we need from a session: each turn's recorded cost (null = unknown). */
interface CostedSession {
  turns: { costUsd: number | null }[];
}

/** Sum a session's recorded turn costs (turns with no cost count as 0). */
export function sessionCost(session: CostedSession): number {
  return session.turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
}

/**
 * Mean $/session over past sessions that recorded a non-zero cost. Sessions with
 * no cost data (never ran, or a CLI that doesn't report cost — e.g. opencode free
 * models) are excluded so they don't drag the average to zero and under-warn.
 */
export function estimateRunCost(sessions: CostedSession[]): RunCostEstimate {
  const totals = sessions.map(sessionCost).filter((t) => t > 0);
  if (totals.length === 0) return { perSession: null, sampleSize: 0 };
  const perSession = totals.reduce((a, b) => a + b, 0) / totals.length;
  return { perSession, sampleSize: totals.length };
}

/** `$1.2345` → "$1.23"; sub-dollar keeps more precision ("$0.084") since agent
 *  runs are often a few cents. */
export function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}
