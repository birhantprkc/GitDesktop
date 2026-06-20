import { triggerAutomations } from "./runner";

/**
 * Per-`(kind, repo, ref)` last head we already fired a pr-sync event for. A head
 * change fires at most once — not on every poll tick — so the watchers can call
 * `maybeFireSync` freely. The runner does the real work (per-mode watermark gate
 * + build-on-prior); this just debounces the trigger by head.
 *
 * Intentionally never reclaimed (the dedup must survive a repo view unmounting),
 * so it holds one small entry per distinct PR observed this session — a bounded,
 * negligible footprint that resets on restart.
 */
const lastFiredHead = new Map<string, string>();

export interface SyncCandidate {
  repoPath: string;
  kind: "remote" | "local";
  /** Remote PR number (as a string) or local PR id. */
  ref: string;
  /** The PR head's current tip SHA. */
  currentHeadSha: string;
  base: string;
  head: string;
  title: string;
  body: string;
  commitSubjects: string[];
}

/**
 * Fires a `pr-sync` automation event when an open PR's head has advanced since
 * the last time we fired for it. Deduped by head, so an unchanged PR observed on
 * every poll never re-fires. The runner gates whether to actually review (only a
 * PR already reviewed in a mode, whose head is past that mode's watermark).
 */
export function maybeFireSync(c: SyncCandidate): void {
  if (!c.currentHeadSha) return;
  const key = `${c.kind}:${c.repoPath}#${c.ref}`;
  if (lastFiredHead.get(key) === c.currentHeadSha) return;
  lastFiredHead.set(key, c.currentHeadSha);
  triggerAutomations({
    kind: "pr-sync",
    repoPath: c.repoPath,
    base: c.base,
    head: c.head,
    headSha: c.currentHeadSha,
    title: c.title,
    body: c.body,
    commitSubjects: c.commitSubjects,
    target:
      c.kind === "remote"
        ? { type: "remote", number: Number(c.ref) }
        : { type: "local", id: c.ref },
  });
}
