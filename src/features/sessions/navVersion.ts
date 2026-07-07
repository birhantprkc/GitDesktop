/**
 * A monotonic counter that ticks on EVERY change to the agent-surface selection
 * (which research / plan / session is active, or none). It lives in its own tiny
 * module — not in `agentSelect.ts` — because the three selection stores must bump
 * it from inside their `setActive*` setters, and `agentSelect.ts` already imports
 * those stores; a store importing `agentSelect` back would be a cycle.
 *
 * Why a counter and not just comparing the selected ids: an async handoff (the
 * research→plan distill) captures the selection at click and, on completion, only
 * steals the canvas if the user is still where they were. Comparing ids alone has a
 * false-positive — navigate Research X → Plan Y → back to Research X and the ids
 * equal X again, so an id-only check reports "unchanged" and yanks a user who
 * deliberately navigated. The counter ticks on each of those hops, so any navigation
 * (even one that lands back on the same id) is detected. Bumping is cheap and
 * over-bumping is safe: a spurious tick only makes a completing handoff decline to
 * navigate (it sets the pending seed regardless), which is the non-hostile direction.
 */
let navVersion = 0;

/** Advance the counter — called by every store setter that changes an active id. */
export function bumpNavVersion(): void {
  navVersion++;
}

/** The current navigation version, snapshotted at click and compared at completion. */
export function currentNavVersion(): number {
  return navVersion;
}
