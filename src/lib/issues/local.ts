import { load, type Store } from "@tauri-apps/plugin-store";
import { storeName } from "@/lib/test-mode";

export interface LocalIssueComment {
  id: string;
  body: string;
  createdAt: string;
  /** Collapsed in the conversation (local equivalent of GitHub's "hide"). */
  hidden?: boolean;
}

export type LocalIssueStatus = "open" | "closed";

export interface LocalIssue {
  id: string;
  title: string;
  body: string;
  status: LocalIssueStatus;
  /** Free-form labels (local issues aren't tied to the repo's GitHub labels). */
  labels: string[];
  comments: LocalIssueComment[];
  createdAt: string;
  closedAt?: string;
  /** Hidden from the list unless "Show archived" — a soft alternative to delete. */
  archived?: boolean;
}

// Personal app-data, keyed by repo path — never written into the repo itself.
let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  storePromise ??= load(storeName("local-issues.json"), {
    autoSave: true,
    defaults: {},
  });
  return storePromise;
}

export async function listLocalIssues(repo: string): Promise<LocalIssue[]> {
  const store = await getStore();
  const issues = (await store.get<LocalIssue[]>(repo)) ?? [];
  // Tolerate issues saved before the labels field existed.
  return issues.map((i) => ({ ...i, labels: i.labels ?? [] }));
}

async function writeAll(repo: string, issues: LocalIssue[]): Promise<void> {
  const store = await getStore();
  await store.set(repo, issues);
}

export async function createLocalIssue(
  repo: string,
  input: { title: string; body: string },
): Promise<LocalIssue> {
  const issue: LocalIssue = {
    id: crypto.randomUUID(),
    title: input.title,
    body: input.body,
    status: "open",
    labels: [],
    comments: [],
    createdAt: new Date().toISOString(),
  };
  const all = await listLocalIssues(repo);
  await writeAll(repo, [issue, ...all]);
  return issue;
}

/** Upserts the given issue (used for comment/label/status edits). */
export async function saveLocalIssue(
  repo: string,
  issue: LocalIssue,
): Promise<void> {
  const all = await listLocalIssues(repo);
  await writeAll(
    repo,
    all.map((i) => (i.id === issue.id ? issue : i)),
  );
}

export async function deleteLocalIssue(
  repo: string,
  id: string,
): Promise<void> {
  const all = await listLocalIssues(repo);
  await writeAll(
    repo,
    all.filter((i) => i.id !== id),
  );
}
