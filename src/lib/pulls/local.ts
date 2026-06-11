import { load, type Store } from "@tauri-apps/plugin-store";

export interface LocalPrComment {
  id: string;
  body: string;
  createdAt: string;
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
  comments: LocalPrComment[];
  createdAt: string;
  mergedAt?: string;
}

// Personal app-data, keyed by repo path — never written into the repo itself.
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load("local-prs.json", { autoSave: true, defaults: {} });
  return storePromise;
}

export async function listLocalPrs(repo: string): Promise<LocalPr[]> {
  const store = await getStore();
  return (await store.get<LocalPr[]>(repo)) ?? [];
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
