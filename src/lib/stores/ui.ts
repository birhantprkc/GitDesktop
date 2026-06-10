import { create } from "zustand";
import type { RepoInfo } from "@/lib/git/types";

export type AppView = "welcome" | "repo" | "settings";
export type RepoTab = "changes" | "history";

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
  selectedFile: SelectedFile | null;
  selectedCommitHash: string | null;
  commitTitle: string;
  commitBody: string;
  generating: boolean;

  openRepo: (info: RepoInfo) => void;
  closeRepo: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  setRepoTab: (tab: RepoTab) => void;
  selectFile: (file: SelectedFile | null) => void;
  selectCommit: (hash: string | null) => void;
  setCommitDraft: (title: string, body: string) => void;
  setCommitTitle: (title: string) => void;
  setCommitBody: (body: string) => void;
  clearCommitDraft: () => void;
  setGenerating: (generating: boolean) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  view: "welcome",
  previousView: "welcome",
  repoPath: null,
  repoName: null,
  repoTab: "changes",
  selectedFile: null,
  selectedCommitHash: null,
  commitTitle: "",
  commitBody: "",
  generating: false,

  openRepo: (info) =>
    set({
      view: "repo",
      previousView: "repo",
      repoPath: info.root,
      repoName: info.name,
      repoTab: "changes",
      selectedFile: null,
      selectedCommitHash: null,
      commitTitle: "",
      commitBody: "",
    }),
  closeRepo: () =>
    set({
      view: "welcome",
      previousView: "welcome",
      repoPath: null,
      repoName: null,
      repoTab: "changes",
      selectedFile: null,
      selectedCommitHash: null,
    }),
  setRepoTab: (tab) => set({ repoTab: tab }),
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
  clearCommitDraft: () => set({ commitTitle: "", commitBody: "" }),
  setGenerating: (generating) => set({ generating }),
}));
