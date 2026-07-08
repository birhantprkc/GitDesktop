import { load, type Store } from "@tauri-apps/plugin-store";
import type { ReviewMode } from "@/lib/ai/types";
import {
  identityKeyFor,
  mergeById,
  repoIdentity,
} from "@/lib/git/repo-identity";
import { storeName } from "@/lib/test-mode";

/**
 * A finished AI review, persisted so the NEXT run of the same PR + mode can feed
 * it back as soft context. Free-form `text` is never parsed into structured data
 * — it stays the model's own markdown, which the next run must re-verify against
 * the current diff. Identity for "the previous review" is `(kind, ref, mode)`;
 * `mode` is part of the key so a security re-run never inherits general findings.
 */
export interface PersistedReview {
  schemaVersion: 1;
  id: string;
  kind: "remote" | "local";
  /** Remote PR number (as a string) or local PR id. */
  ref: string;
  mode: ReviewMode;
  model: string;
  title: string;
  /** Raw finding markdown — the soft context fed into the next run. */
  text: string;
  /** PR head at the time this review ran — the delta anchor for the next run. */
  headSha: string;
  startedAt: number;
  finishedAt: number;
}

/** Reviews kept per `(kind, ref, mode)` — enough to show iteration, bounded so
 *  the store file never balloons. Pruned on every write. */
const MAX_PER_GROUP = 3;

const groupKey = (r: Pick<PersistedReview, "kind" | "ref" | "mode">) =>
  `${r.kind}#${r.ref}#${r.mode}`;

// Personal app-data, keyed by repo path — never written into the repo itself
// (the text quotes user source + may contain AI false positives). Routed through
// storeName() so cold-start/test mode never pollutes real history.
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(storeName("pr-reviews.json"), {
    autoSave: true,
    defaults: {},
  });
  return storePromise;
}

// Records are keyed by the repo's worktree-stable identity (not its checkout
// path) so a PR's review history is shared across the main checkout and every
// worktree. Reads merge in any records still under a legacy checkout-path key
// (folded onto the identity key by the next write via `keyFor`).
async function readMerged(repo: string): Promise<PersistedReview[]> {
  const store = await getStore();
  const id = await repoIdentity(repo);
  const primary = (await store.get<PersistedReview[]>(id)) ?? [];
  const legacy =
    id === repo ? [] : ((await store.get<PersistedReview[]>(repo)) ?? []);
  return mergeById(primary, legacy);
}

async function keyFor(repo: string): Promise<string> {
  const store = await getStore();
  return identityKeyFor<PersistedReview[]>(
    store,
    "pr-reviews",
    repo,
    mergeById,
  );
}

async function readByKey(key: string): Promise<PersistedReview[]> {
  const store = await getStore();
  return (await store.get<PersistedReview[]>(key)) ?? [];
}

async function writeAll(
  key: string,
  records: PersistedReview[],
): Promise<void> {
  const store = await getStore();
  await store.set(key, records);
}

/** Keeps only the newest `MAX_PER_GROUP` reviews per `(kind, ref, mode)`. */
function prune(records: PersistedReview[]): PersistedReview[] {
  const groups = new Map<string, PersistedReview[]>();
  for (const r of records) {
    const key = groupKey(r);
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }
  const kept: PersistedReview[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.finishedAt - a.finishedAt);
    kept.push(...group.slice(0, MAX_PER_GROUP));
  }
  return kept;
}

/** The most recent review for a specific PR + mode, or undefined if none. */
export async function getLatestReview(
  repo: string,
  kind: "remote" | "local",
  ref: string,
  mode: ReviewMode,
): Promise<PersistedReview | undefined> {
  const all = await readMerged(repo);
  return all
    .filter((r) => r.kind === kind && r.ref === ref && r.mode === mode)
    .sort((a, b) => b.finishedAt - a.finishedAt)[0];
}

/** Every persisted review for a PR (both modes), newest first — for the
 *  "Previous reviews" disclosure. */
export async function listReviews(
  repo: string,
  kind: "remote" | "local",
  ref: string,
): Promise<PersistedReview[]> {
  const all = await readMerged(repo);
  return all
    .filter((r) => r.kind === kind && r.ref === ref)
    .sort((a, b) => b.finishedAt - a.finishedAt);
}

/** Upserts a finished review by id, then prunes its group to the newest few. */
export async function saveReview(
  repo: string,
  record: PersistedReview,
): Promise<void> {
  const key = await keyFor(repo);
  const all = await readByKey(key);
  const without = all.filter((r) => r.id !== record.id);
  await writeAll(key, prune([record, ...without]));
}

/** Replaces a stored review's text — backs "trim before re-running" so a user
 *  can delete a false finding and have the edit persist across rounds. */
export async function updateReviewText(
  repo: string,
  id: string,
  text: string,
): Promise<void> {
  const key = await keyFor(repo);
  const all = await readByKey(key);
  await writeAll(
    key,
    all.map((r) => (r.id === id ? { ...r, text } : r)),
  );
}

export async function deleteReview(repo: string, id: string): Promise<void> {
  const key = await keyFor(repo);
  const all = await readByKey(key);
  await writeAll(
    key,
    all.filter((r) => r.id !== id),
  );
}

/** Clears every persisted review for ONE PR (both modes) — scoped so clearing
 *  from a PR's panel never touches the other PRs' history in the same repo. */
export async function clearReviewsFor(
  repo: string,
  kind: "remote" | "local",
  ref: string,
): Promise<void> {
  const key = await keyFor(repo);
  const all = await readByKey(key);
  await writeAll(
    key,
    all.filter((r) => !(r.kind === kind && r.ref === ref)),
  );
}
