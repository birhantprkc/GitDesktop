import { create } from "zustand";
import type { CommitAuthor, RepoInfo } from "@/lib/git/types";

export type AppView = "welcome" | "repo" | "settings" | "help";
export type RepoTab = "changes" | "history" | "compare" | "pulls" | "actions";
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

export interface SelectedFile {
  path: string;
  staged: boolean;
  untracked: boolean;
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
  /** Selected workflow run (databaseId) on the Actions tab. */
  selectedRunId: number | null;
  selectedFile: SelectedFile | null;
  selectedCommitHash: string | null;
  commitTitle: string;
  commitBody: string;
  /** Co-authors credited on the next commit (Co-authored-by trailers). */
  commitCoAuthors: CommitAuthor[];
  generating: boolean;
  /** Hash of the commit being amended, or null for a normal commit. */
  amendingHash: string | null;

  openRepo: (info: RepoInfo) => void;
  closeRepo: () => void;
  openSettings: (target?: SettingsTarget) => void;
  clearSettingsTarget: () => void;
  closeSettings: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  setRepoTab: (tab: RepoTab) => void;
  setCompareBranch: (branch: string | null) => void;
  selectPr: (pr: SelectedPr | null) => void;
  selectRun: (id: number | null) => void;
  selectFile: (file: SelectedFile | null) => void;
  selectCommit: (hash: string | null) => void;
  setCommitDraft: (title: string, body: string) => void;
  setCommitTitle: (title: string) => void;
  setCommitBody: (body: string) => void;
  setCommitCoAuthors: (coAuthors: CommitAuthor[]) => void;
  clearCommitDraft: () => void;
  setGenerating: (generating: boolean) => void;
  setAmending: (hash: string | null) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  view: "welcome",
  previousView: "welcome",
  settingsTarget: null,
  repoPath: null,
  repoName: null,
  repoTab: "changes",
  compareBranch: null,
  selectedPr: null,
  selectedRunId: null,
  selectedFile: null,
  selectedCommitHash: null,
  commitTitle: "",
  commitBody: "",
  commitCoAuthors: [],
  generating: false,
  amendingHash: null,

  openRepo: (info) =>
    set({
      view: "repo",
      previousView: "repo",
      repoPath: info.root,
      repoName: info.name,
      repoTab: "changes",
      compareBranch: null,
      selectedPr: null,
      selectedRunId: null,
      selectedFile: null,
      selectedCommitHash: null,
      commitTitle: "",
      commitBody: "",
      commitCoAuthors: [],
      amendingHash: null,
    }),
  closeRepo: () =>
    set({
      view: "welcome",
      previousView: "welcome",
      repoPath: null,
      repoName: null,
      repoTab: "changes",
      compareBranch: null,
      selectedPr: null,
      selectedRunId: null,
      selectedFile: null,
      selectedCommitHash: null,
    }),
  setRepoTab: (tab) => set({ repoTab: tab }),
  setCompareBranch: (branch) => set({ compareBranch: branch }),
  selectPr: (pr) => set({ selectedPr: pr }),
  selectRun: (id) => set({ selectedRunId: id }),
  selectCommit: (hash) => set({ selectedCommitHash: hash }),
  openSettings: (target) => {
    const { view } = get();
    set({
      view: "settings",
      settingsTarget: target ?? null,
      // Keep the underlying view when opening from another overlay.
      previousView:
        view === "settings" || view === "help" ? get().previousView : view,
    });
  },
  clearSettingsTarget: () => set({ settingsTarget: null }),
  closeSettings: () => set({ view: get().previousView }),
  openHelp: () => {
    const { view } = get();
    set({
      view: "help",
      previousView:
        view === "settings" || view === "help" ? get().previousView : view,
    });
  },
  closeHelp: () => set({ view: get().previousView }),
  selectFile: (file) => set({ selectedFile: file }),
  setCommitDraft: (title, body) =>
    set({ commitTitle: title, commitBody: body }),
  setCommitTitle: (title) => set({ commitTitle: title }),
  setCommitBody: (body) => set({ commitBody: body }),
  setCommitCoAuthors: (coAuthors) => set({ commitCoAuthors: coAuthors }),
  clearCommitDraft: () =>
    set({
      commitTitle: "",
      commitBody: "",
      commitCoAuthors: [],
      amendingHash: null,
    }),
  setGenerating: (generating) => set({ generating }),
  setAmending: (hash) => set({ amendingHash: hash }),
}));
