import { create } from "zustand";
import type { CommitAuthor, RepoInfo } from "@/lib/git/types";
import { startViewTransition } from "@/lib/view-transition";

export type AppView = "welcome" | "repo" | "settings" | "help";
export type RepoTab =
  | "changes"
  | "history"
  | "compare"
  | "pulls"
  | "issues"
  | "discussions"
  | "actions"
  | "tags";
/** A Settings section to open directly (matches SettingsScreen's panel ids). */
export type SettingsTarget =
  | "general"
  | "ai"
  | "automations"
  | "notifications"
  | "keyboard"
  | "accounts"
  | "git"
  | "editor"
  | "terminal"
  | "updates";

export interface SelectedPr {
  kind: "local" | "remote";
  /** Local PR id, or the remote PR number as a string. */
  id: string;
}

export interface SelectedIssue {
  kind: "local" | "remote";
  /** Local issue id, or the remote issue number as a string. */
  id: string;
}

export interface SelectedFile {
  path: string;
  staged: boolean;
  untracked: boolean;
}

/** An in-progress commit message, persisted per repo + branch. */
export interface CommitDraft {
  title: string;
  body: string;
  coAuthors: CommitAuthor[];
  aiGenerated: boolean;
  amendingHash: string | null;
}

const EMPTY_COMMIT_DRAFT: CommitDraft = {
  title: "",
  body: "",
  coAuthors: [],
  aiGenerated: false,
  amendingHash: null,
};

/** Key a commit draft so each repo + branch keeps its own message. A git branch
 *  name can't contain a colon, so the key stays unambiguous. */
export function commitDraftKey(repoPath: string, branch: string): string {
  return `${repoPath}:${branch}`;
}

function isEmptyDraft(d: CommitDraft): boolean {
  return (
    !d.title &&
    !d.body &&
    d.coAuthors.length === 0 &&
    d.amendingHash === null &&
    !d.aiGenerated
  );
}

interface UiState {
  view: AppView;
  /** Underlying view to return to when settings or help closes. */
  previousView: Exclude<AppView, "settings" | "help">;
  /** Settings section to jump to when opening Settings; null = leave as-is.
   *  Consumed (and cleared) by SettingsScreen once applied. */
  settingsTarget: SettingsTarget | null;
  repoPath: string | null;
  repoName: string | null;
  repoTab: RepoTab;
  /** Branch to compare the current branch against, on the Compare tab. */
  compareBranch: string | null;
  /** Selected PR on the Pull Requests tab. */
  selectedPr: SelectedPr | null;
  /** PR sub-tab to land on when the Pulls view next opens a PR — set by the
   *  activity dock's "View" so a finished review opens straight to it;
   *  consumed and cleared by the PR detail views. */
  pendingPrSection: "review" | null;
  /** Selected issue on the Issues tab. */
  selectedIssue: SelectedIssue | null;
  /** Selected discussion (by number) on the Discussions tab. */
  selectedDiscussion: { number: number } | null;
  /** A draft to seed the next GitHub-issue create dialog (e.g. "Reference in
   *  new issue" from a discussion, or "Duplicate issue"); consumed and cleared
   *  by IssuesPanel. `labels` (names) carry over when duplicating. */
  pendingIssueDraft: {
    title: string;
    body: string;
    labels?: string[];
  } | null;
  /** Selected workflow run (databaseId) on the Actions tab. */
  selectedRunId: number | null;
  /** Selected tag (by name) on the Tags tab. */
  selectedTag: { tag: string } | null;
  selectedFile: SelectedFile | null;
  selectedCommitHash: string | null;
  commitTitle: string;
  commitBody: string;
  /** Co-authors credited on the next commit (Co-authored-by trailers). */
  commitCoAuthors: CommitAuthor[];
  generating: boolean;
  /** Whether the current commit draft was produced by AI generation. */
  commitAiGenerated: boolean;
  /** Hash of the commit being amended, or null for a normal commit. */
  amendingHash: string | null;
  /** Saved commit drafts keyed by repo+branch; survives repo/branch switches.
   *  The live commit fields above mirror the entry for `activeDraftKey`. */
  commitDrafts: Record<string, CommitDraft>;
  activeDraftKey: string | null;

  openRepo: (info: RepoInfo) => void;
  closeRepo: () => void;
  /** Open a repo (if not already open) and land on a PR's AI-review sub-tab —
   *  used by the activity dock's "View". One atomic update so the landing
   *  target survives openRepo's own reset. */
  openPrReview: (target: {
    kind: "remote" | "local";
    repoPath: string;
    repoName: string;
    ref: string;
  }) => void;
  openSettings: (target?: SettingsTarget) => void;
  clearSettingsTarget: () => void;
  closeSettings: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  setRepoTab: (tab: RepoTab) => void;
  setCompareBranch: (branch: string | null) => void;
  selectPr: (pr: SelectedPr | null) => void;
  setPendingPrSection: (section: "review" | null) => void;
  selectIssue: (issue: SelectedIssue | null) => void;
  selectDiscussion: (discussion: { number: number } | null) => void;
  setPendingIssueDraft: (
    draft: { title: string; body: string; labels?: string[] } | null,
  ) => void;
  selectRun: (id: number | null) => void;
  selectTag: (tag: { tag: string } | null) => void;
  selectFile: (file: SelectedFile | null) => void;
  selectCommit: (hash: string | null) => void;
  setCommitDraft: (title: string, body: string) => void;
  setCommitTitle: (title: string) => void;
  setCommitBody: (body: string) => void;
  setCommitCoAuthors: (coAuthors: CommitAuthor[]) => void;
  clearCommitDraft: () => void;
  /** Restore a snapshot for the draft `key` it belonged to (re-mirrors it into
   *  `commitDrafts[key]`, and into the live fields only if that key is still
   *  active). Used to undo an optimistic clear when a commit fails — `key` is
   *  captured at submit so a mid-commit branch switch can't restore to the
   *  wrong branch. */
  restoreCommitDraft: (draft: CommitDraft, key: string | null) => void;
  setGenerating: (generating: boolean) => void;
  setCommitAiGenerated: (generated: boolean) => void;
  setAmending: (hash: string | null) => void;
  /** Point the live commit fields at `key`'s saved draft (load on repo/branch
   *  switch). The previous draft is already mirrored in `commitDrafts`. */
  loadCommitDraft: (key: string) => void;
}

export const useUiStore = create<UiState>()((set, get) => {
  // Mirror the live commit-draft fields into commitDrafts[activeDraftKey] on
  // every edit so a draft survives repo/branch switches; empty drafts are
  // pruned so the map doesn't accumulate blanks.
  const setDraftFields = (
    patch: Partial<{
      commitTitle: string;
      commitBody: string;
      commitCoAuthors: CommitAuthor[];
      commitAiGenerated: boolean;
      amendingHash: string | null;
    }>,
  ) =>
    set((s) => {
      const next = {
        commitTitle: s.commitTitle,
        commitBody: s.commitBody,
        commitCoAuthors: s.commitCoAuthors,
        commitAiGenerated: s.commitAiGenerated,
        amendingHash: s.amendingHash,
        ...patch,
      };
      const result: Partial<UiState> = { ...patch };
      if (s.activeDraftKey) {
        const draft: CommitDraft = {
          title: next.commitTitle,
          body: next.commitBody,
          coAuthors: next.commitCoAuthors,
          aiGenerated: next.commitAiGenerated,
          amendingHash: next.amendingHash,
        };
        const drafts = { ...s.commitDrafts };
        if (isEmptyDraft(draft)) delete drafts[s.activeDraftKey];
        else drafts[s.activeDraftKey] = draft;
        result.commitDrafts = drafts;
      }
      return result;
    });

  return {
    view: "welcome",
    previousView: "welcome",
    settingsTarget: null,
    repoPath: null,
    repoName: null,
    repoTab: "changes",
    compareBranch: null,
    selectedPr: null,
    pendingPrSection: null,
    selectedIssue: null,
    selectedDiscussion: null,
    pendingIssueDraft: null,
    selectedRunId: null,
    selectedTag: null,
    selectedFile: null,
    selectedCommitHash: null,
    commitTitle: "",
    commitBody: "",
    commitCoAuthors: [],
    generating: false,
    commitAiGenerated: false,
    amendingHash: null,
    commitDrafts: {},
    activeDraftKey: null,

    openRepo: (info) =>
      startViewTransition(() =>
        set({
          view: "repo",
          previousView: "repo",
          repoPath: info.root,
          repoName: info.name,
          repoTab: "changes",
          compareBranch: null,
          selectedPr: null,
          pendingPrSection: null,
          selectedIssue: null,
          selectedDiscussion: null,
          pendingIssueDraft: null,
          selectedRunId: null,
          selectedTag: null,
          selectedFile: null,
          selectedCommitHash: null,
          // Clear the live fields; the previous repo's draft stays in
          // commitDrafts (keyed by repo+branch) and CommitBox reloads the new
          // repo's draft once its branch is known.
          commitTitle: "",
          commitBody: "",
          commitCoAuthors: [],
          commitAiGenerated: false,
          amendingHash: null,
          activeDraftKey: null,
        }),
      ),
    closeRepo: () =>
      startViewTransition(() =>
        set({
          view: "welcome",
          previousView: "welcome",
          repoPath: null,
          repoName: null,
          repoTab: "changes",
          compareBranch: null,
          selectedPr: null,
          pendingPrSection: null,
          selectedIssue: null,
          selectedDiscussion: null,
          pendingIssueDraft: null,
          selectedRunId: null,
          selectedTag: null,
          selectedFile: null,
          selectedCommitHash: null,
          commitTitle: "",
          commitBody: "",
          commitCoAuthors: [],
          commitAiGenerated: false,
          amendingHash: null,
          activeDraftKey: null,
        }),
      ),
    openPrReview: (target) =>
      startViewTransition(() => {
        const switchingRepo = get().repoPath !== target.repoPath;
        set({
          view: "repo",
          previousView: "repo",
          repoPath: target.repoPath,
          repoName: target.repoName,
          repoTab: "pulls",
          selectedPr: { kind: target.kind, id: target.ref },
          pendingPrSection: "review",
          // Switching repos clears the rest the way openRepo does; staying in
          // the same repo keeps your other selections and just retargets the PR.
          ...(switchingRepo
            ? {
                compareBranch: null,
                selectedIssue: null,
                selectedDiscussion: null,
                pendingIssueDraft: null,
                selectedRunId: null,
                selectedTag: null,
                selectedFile: null,
                selectedCommitHash: null,
                commitTitle: "",
                commitBody: "",
                commitCoAuthors: [],
                commitAiGenerated: false,
                amendingHash: null,
                activeDraftKey: null,
              }
            : {}),
        });
      }),
    setRepoTab: (tab) => set({ repoTab: tab }),
    setCompareBranch: (branch) => set({ compareBranch: branch }),
    selectPr: (pr) => set({ selectedPr: pr }),
    setPendingPrSection: (section) => set({ pendingPrSection: section }),
    selectIssue: (issue) => set({ selectedIssue: issue }),
    selectDiscussion: (discussion) => set({ selectedDiscussion: discussion }),
    setPendingIssueDraft: (draft) => set({ pendingIssueDraft: draft }),
    selectRun: (id) => set({ selectedRunId: id }),
    selectTag: (tag) => set({ selectedTag: tag }),
    selectCommit: (hash) => set({ selectedCommitHash: hash }),
    openSettings: (target) =>
      startViewTransition(() => {
        const { view } = get();
        set({
          view: "settings",
          settingsTarget: target ?? null,
          // Keep the underlying view when opening from another overlay.
          previousView:
            view === "settings" || view === "help" ? get().previousView : view,
        });
      }),
    clearSettingsTarget: () => set({ settingsTarget: null }),
    closeSettings: () =>
      startViewTransition(() => set({ view: get().previousView })),
    openHelp: () =>
      startViewTransition(() => {
        const { view } = get();
        set({
          view: "help",
          previousView:
            view === "settings" || view === "help" ? get().previousView : view,
        });
      }),
    closeHelp: () =>
      startViewTransition(() => set({ view: get().previousView })),
    selectFile: (file) => set({ selectedFile: file }),
    setCommitDraft: (title, body) =>
      setDraftFields({ commitTitle: title, commitBody: body }),
    setCommitTitle: (title) => setDraftFields({ commitTitle: title }),
    setCommitBody: (body) => setDraftFields({ commitBody: body }),
    setCommitCoAuthors: (coAuthors) =>
      setDraftFields({ commitCoAuthors: coAuthors }),
    clearCommitDraft: () =>
      set((s) => {
        const drafts = { ...s.commitDrafts };
        if (s.activeDraftKey) delete drafts[s.activeDraftKey];
        return {
          commitTitle: "",
          commitBody: "",
          commitCoAuthors: [],
          commitAiGenerated: false,
          amendingHash: null,
          commitDrafts: drafts,
        };
      }),
    restoreCommitDraft: (draft, key) =>
      set((s) => {
        const result: Partial<UiState> = {};
        // Put the message back into the draft it belonged to.
        if (key) {
          const drafts = { ...s.commitDrafts };
          if (isEmptyDraft(draft)) delete drafts[key];
          else drafts[key] = draft;
          result.commitDrafts = drafts;
        }
        // Only touch the live fields if that draft is still the active one —
        // if the user switched branches mid-commit, leave their current draft
        // alone (the restored message reappears when they switch back).
        if (s.activeDraftKey === key) {
          result.commitTitle = draft.title;
          result.commitBody = draft.body;
          result.commitCoAuthors = draft.coAuthors;
          result.commitAiGenerated = draft.aiGenerated;
          result.amendingHash = draft.amendingHash;
        }
        return result;
      }),
    setGenerating: (generating) => set({ generating }),
    setCommitAiGenerated: (generated) =>
      setDraftFields({ commitAiGenerated: generated }),
    setAmending: (hash) => setDraftFields({ amendingHash: hash }),
    loadCommitDraft: (key) =>
      set((s) => {
        // The outgoing draft is already mirrored in commitDrafts, so just point
        // the live fields at the requested key's draft (or a blank one).
        if (key === s.activeDraftKey) return {};
        const d = s.commitDrafts[key] ?? EMPTY_COMMIT_DRAFT;
        return {
          activeDraftKey: key,
          commitTitle: d.title,
          commitBody: d.body,
          commitCoAuthors: d.coAuthors,
          commitAiGenerated: d.aiGenerated,
          amendingHash: d.amendingHash,
        };
      }),
  };
});
