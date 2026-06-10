import { create } from "zustand";
import type { RepoInfo } from "@/lib/git/types";

export type AppView = "welcome" | "repo" | "settings";
export type RepoTab = "changes" | "history" | "compare";

export interface SelectedFile {
  path: string;
  staged: boolean;
  untracked: boolean;
}

interface UiState {
  view: AppView;
  /** View to return to when settings closes. */
  previousView: Exclude<AppView, "settings">;
  repoPath: string | null;
  repoName: string | null;
  repoTab: RepoTab;
  /** Branch to compare the current branch against, on the Compare tab. */
  compareBranch: string | null;
  selectedFile: SelectedFile | null;
  selectedCommitHash: string | null;
  commitTitle: string;
  commitBody: string;
  generating: boolean;
  /** Hash of the commit being amended, or null for a normal commit. */
  amendingHash: string | null;

  openRepo: (info: RepoInfo) => void;
  closeRepo: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  setRepoTab: (tab: RepoTab) => void;
  setCompareBranch: (branch: string | null) => void;
  selectFile: (file: SelectedFile | null) => void;
  selectCommit: (hash: string | null) => void;
  setCommitDraft: (title: string, body: string) => void;
  setCommitTitle: (title: string) => void;
  setCommitBody: (body: string) => void;
  clearCommitDraft: () => void;
  setGenerating: (generating: boolean) => void;
  setAmending: (hash: string | null) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  view: "welcome",
  previousView: "welcome",
  repoPath: null,
  repoName: null,
  repoTab: "changes",
  compareBranch: null,
  selectedFile: null,
  selectedCommitHash: null,
  commitTitle: "",
  commitBody: "",
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
      selectedFile: null,
      selectedCommitHash: null,
      commitTitle: "",
      commitBody: "",
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
      selectedFile: null,
      selectedCommitHash: null,
    }),
  setRepoTab: (tab) => set({ repoTab: tab }),
  setCompareBranch: (branch) => set({ compareBranch: branch }),
  selectCommit: (hash) => set({ selectedCommitHash: hash }),
  openSettings: () => {
    const { view } = get();
    set({
      view: "settings",
      previousView: view === "settings" ? get().previousView : view,
    });
  },
  closeSettings: () => set({ view: get().previousView }),
  selectFile: (file) => set({ selectedFile: file }),
  setCommitDraft: (title, body) =>
    set({ commitTitle: title, commitBody: body }),
  setCommitTitle: (title) => set({ commitTitle: title }),
  setCommitBody: (body) => set({ commitBody: body }),
  clearCommitDraft: () =>
    set({ commitTitle: "", commitBody: "", amendingHash: null }),
  setGenerating: (generating) => set({ generating }),
  setAmending: (hash) => set({ amendingHash: hash }),
}));
