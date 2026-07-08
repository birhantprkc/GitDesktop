import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  identityKeyFor,
  mergeById,
  repoIdentity,
} from "@/lib/git/repo-identity";
import { storeName } from "@/lib/test-mode";

/** One pending draft comment in a not-yet-submitted batch review. `id` is a local
 *  uuid (these drafts never leave the client until the review is submitted). */
export interface ReviewDraft {
  id: string;
  path: string;
  line: number;
  /** "new" (right side) or "old" (left side). */
  side: "new" | "old";
  /** First line of a multi-line range (1-based); omitted for a single line. */
  startLine?: number;
  body: string;
  createdAt: string;
}

/** Drafts for one PR/MR, keyed by its number as a string. */
type PrDrafts = Record<string, ReviewDraft[]>;

// Personal app-data, keyed by repo path → per-PR drafts — never written into the
// repo itself. Mirrors `local.ts`'s store idiom.
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(storeName("pr-review-drafts.json"), {
    autoSave: true,
    defaults: {},
  });
  return storePromise;
}

// Serialize every read-modify-write on this store through one in-process queue.
// Without it, two overlapping mutations each reload the SAME pre-flush disk
// snapshot — autoSave persists on a ~100ms debounce, so the first write isn't on
// disk yet — and the later write drops the earlier one's change (a lost update).
// Running them one at a time, plus the force-save in writeAll, guarantees each
// read sees a current snapshot. (This repo has been bitten by store write races.)
let opChain: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const run = opChain.then(op, op);
  // Keep the queue alive whether `op` fulfilled or rejected; callers still get `run`.
  opChain = run.catch(() => undefined);
  return run;
}

/** Merge two per-PR draft maps, de-duplicating each PR's drafts by id (`keep`
 *  wins). Folds a legacy checkout-path draft map into the identity key's. */
function mergeDrafts(keep: PrDrafts | undefined, extra: PrDrafts): PrDrafts {
  const out: PrDrafts = { ...(keep ?? {}) };
  for (const [num, drafts] of Object.entries(extra)) {
    out[num] = mergeById(out[num], drafts);
  }
  return out;
}

// Keyed by the repo's worktree-stable identity (not its checkout path) so draft
// reviews are shared across the main checkout and every worktree. Reads merge in
// any drafts still under a legacy checkout-path key (folded on the next write).
async function readMerged(repo: string): Promise<PrDrafts> {
  const store = await getStore();
  const id = await repoIdentity(repo);
  const primary = (await store.get<PrDrafts>(id)) ?? {};
  const legacy = id === repo ? {} : ((await store.get<PrDrafts>(repo)) ?? {});
  return mergeDrafts(primary, legacy);
}

/** Identity store key for `repo`, folding any legacy checkout-path drafts onto it
 *  once. Call inside the serialized queue. */
async function keyFor(repo: string): Promise<string> {
  const store = await getStore();
  return identityKeyFor<PrDrafts>(store, "pr-review-drafts", repo, mergeDrafts);
}

async function readByKey(key: string): Promise<PrDrafts> {
  const store = await getStore();
  return (await store.get<PrDrafts>(key)) ?? {};
}

async function writeRepo(key: string, drafts: PrDrafts): Promise<void> {
  const store = await getStore();
  await store.set(key, drafts);
  // Flush now instead of on autoSave's debounce, so the next serialized read can't
  // re-read a pre-write disk snapshot and drop this change.
  await store.save();
}

export async function listDrafts(
  repo: string,
  number: number,
): Promise<ReviewDraft[]> {
  const all = await readMerged(repo);
  return all[String(number)] ?? [];
}

export async function addDraft(
  repo: string,
  number: number,
  draft: ReviewDraft,
): Promise<void> {
  return serialize(async () => {
    const repoKey = await keyFor(repo);
    const all = await readByKey(repoKey);
    const k = String(number);
    await writeRepo(repoKey, { ...all, [k]: [...(all[k] ?? []), draft] });
  });
}

export async function updateDraft(
  repo: string,
  number: number,
  id: string,
  body: string,
): Promise<void> {
  return serialize(async () => {
    const repoKey = await keyFor(repo);
    const all = await readByKey(repoKey);
    const k = String(number);
    const next = (all[k] ?? []).map((d) => (d.id === id ? { ...d, body } : d));
    await writeRepo(repoKey, { ...all, [k]: next });
  });
}

export async function removeDraft(
  repo: string,
  number: number,
  id: string,
): Promise<void> {
  return serialize(async () => {
    const repoKey = await keyFor(repo);
    const all = await readByKey(repoKey);
    const k = String(number);
    await writeRepo(repoKey, {
      ...all,
      [k]: (all[k] ?? []).filter((d) => d.id !== id),
    });
  });
}

export async function clearDrafts(repo: string, number: number): Promise<void> {
  return serialize(async () => {
    const repoKey = await keyFor(repo);
    const all = await readByKey(repoKey);
    const next = { ...all };
    delete next[String(number)];
    await writeRepo(repoKey, next);
  });
}

// ── React-query wrappers ─────────────────────────────────────────────────────

const reviewDraftsKey = (repo: string, number: number) =>
  ["repo", repo, "pr", number, "review-drafts"] as const;

/** The persisted pending-review drafts for a PR/MR. */
export function useReviewDrafts(repo: string, number: number) {
  return useQuery({
    queryKey: reviewDraftsKey(repo, number),
    queryFn: () => listDrafts(repo, number),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAddReviewDraft(repo: string, number: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: ReviewDraft) => addDraft(repo, number, draft),
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: reviewDraftsKey(repo, number),
      }),
  });
}

export function useUpdateReviewDraft(repo: string, number: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; body: string }) =>
      updateDraft(repo, number, args.id, args.body),
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: reviewDraftsKey(repo, number),
      }),
  });
}

export function useRemoveReviewDraft(repo: string, number: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeDraft(repo, number, id),
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: reviewDraftsKey(repo, number),
      }),
  });
}

export function useClearReviewDrafts(repo: string, number: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearDrafts(repo, number),
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: reviewDraftsKey(repo, number),
      }),
  });
}
