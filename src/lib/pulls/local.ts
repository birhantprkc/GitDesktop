import { load, type Store } from "@tauri-apps/plugin-store";
import { storeName } from "@/lib/test-mode";

export interface LocalPrComment {
  id: string;
  body: string;
  createdAt: string;
  /** Collapsed in the conversation (local equivalent of GitHub's "hide"). */
  hidden?: boolean;
}

export type LocalPrStatus = "open" | "merged" | "closed";

export interface LocalPr {
  id: string;
  title: string;
  body: string;
  base: string;
  head: string;
  status: LocalPrStatus;
  approved: boolean;
  /** Free-form labels (local PRs aren't tied to the repo's GitHub labels). */
  labels: string[];
  comments: LocalPrComment[];
  createdAt: string;
  mergedAt?: string;
  /** Hidden from the list unless "Show archived" — a soft alternative to delete. */
  archived?: boolean;
}

// Personal app-data, keyed by repo path — never written into the repo itself.
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(storeName("local-prs.json"), {
    autoSave: true,
    defaults: {},
  });
  return storePromise;
}

export async function listLocalPrs(repo: string): Promise<LocalPr[]> {
  const store = await getStore();
  const prs = (await store.get<LocalPr[]>(repo)) ?? [];
  // Tolerate PRs saved before the labels field existed.
  return prs.map((p) => ({ ...p, labels: p.labels ?? [] }));
}

async function writeAll(repo: string, prs: LocalPr[]): Promise<void> {
  const store = await getStore();
  await store.set(repo, prs);
}

export async function createLocalPr(
  repo: string,
  input: { title: string; body: string; base: string; head: string },
): Promise<LocalPr> {
  const pr: LocalPr = {
    id: crypto.randomUUID(),
    title: input.title,
    body: input.body,
    base: input.base,
    head: input.head,
    status: "open",
    approved: false,
    labels: [],
    comments: [],
    createdAt: new Date().toISOString(),
  };
  const all = await listLocalPrs(repo);
  await writeAll(repo, [pr, ...all]);
  return pr;
}

/** Upserts the given PR (used for approve/comment/status edits). */
export async function saveLocalPr(repo: string, pr: LocalPr): Promise<void> {
  const all = await listLocalPrs(repo);
  await writeAll(
    repo,
    all.map((p) => (p.id === pr.id ? pr : p)),
  );
}

export async function deleteLocalPr(repo: string, id: string): Promise<void> {
  const all = await listLocalPrs(repo);
  await writeAll(
    repo,
    all.filter((p) => p.id !== id),
  );
}
