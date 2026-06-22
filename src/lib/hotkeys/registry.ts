/**
 * Every hotkey-able action in the app. The settings editor, the shortcuts
 * cheat sheet, and the command palette all render from this list, so adding
 * an action here (plus a `useHotkeyAction` registration in the component
 * that owns it) is the whole job.
 *
 * Default bindings match GitHub Desktop where an equivalent exists.
 * `defaultBinding: null` means palette-only until the user binds a key.
 */

export type ActionCategory =
  | "Application"
  | "Navigation"
  | "Repository"
  | "Branches & stash"
  | "Changes"
  | "Agent"
  | "Pull requests";

export interface ActionDef {
  id: string;
  label: string;
  category: ActionCategory;
  /** Canonical binding ("mod+shift+p") or null for palette-only. */
  defaultBinding: string | null;
}

export const ACTIONS = [
  // Application
  {
    id: "open-settings",
    label: "Open settings",
    category: "Application",
    defaultBinding: "mod+,",
  },
  {
    id: "show-shortcuts",
    label: "Keyboard shortcuts",
    category: "Application",
    defaultBinding: "mod+/",
  },
  {
    id: "command-palette",
    label: "Command palette",
    category: "Application",
    defaultBinding: "mod+k",
  },
  {
    id: "show-help",
    label: "Open user guide",
    category: "Application",
    defaultBinding: "f1",
  },

  // Navigation
  {
    id: "tab-changes",
    label: "Changes tab",
    category: "Navigation",
    defaultBinding: "mod+1",
  },
  {
    id: "tab-history",
    label: "History tab",
    category: "Navigation",
    defaultBinding: "mod+2",
  },
  {
    id: "tab-compare",
    label: "Compare tab",
    category: "Navigation",
    defaultBinding: "mod+3",
  },
  {
    id: "tab-pulls",
    label: "Pull Requests tab",
    category: "Navigation",
    defaultBinding: "mod+4",
  },
  {
    id: "tab-actions",
    label: "Actions tab",
    category: "Navigation",
    defaultBinding: "mod+5",
  },
  {
    id: "tab-issues",
    label: "Issues tab",
    category: "Navigation",
    defaultBinding: "mod+6",
  },
  {
    id: "tab-discussions",
    label: "Discussions tab",
    category: "Navigation",
    defaultBinding: "mod+7",
  },
  {
    id: "tab-tags",
    label: "Tags tab",
    category: "Navigation",
    defaultBinding: "mod+8",
  },
  {
    id: "tab-insights",
    label: "Insights tab",
    category: "Navigation",
    defaultBinding: "mod+9",
  },
  {
    id: "tab-agent",
    label: "Agent tab",
    category: "Navigation",
    // Palette-only by default: mod+1–9 are taken by the other tabs, and this
    // tab only exists when AI features are enabled. Users can bind a key.
    defaultBinding: null,
  },
  {
    id: "show-repositories",
    label: "Show repositories",
    category: "Navigation",
    defaultBinding: "mod+t",
  },
  {
    id: "show-branches",
    label: "Show branches",
    category: "Navigation",
    defaultBinding: "mod+b",
  },
  {
    id: "back-to-repositories",
    label: "Back to repositories",
    category: "Navigation",
    defaultBinding: "mod+w",
  },
  {
    id: "focus-filter",
    label: "Focus the filter",
    category: "Navigation",
    defaultBinding: "mod+f",
  },

  // Repository
  {
    id: "push",
    label: "Push",
    category: "Repository",
    defaultBinding: "mod+p",
  },
  {
    id: "pull",
    label: "Pull",
    category: "Repository",
    defaultBinding: "mod+shift+p",
  },
  { id: "fetch", label: "Fetch", category: "Repository", defaultBinding: "f5" },
  {
    id: "open-in-terminal",
    label: "Open in terminal",
    category: "Repository",
    defaultBinding: "mod+`",
  },
  {
    id: "show-in-explorer",
    label: "Show in Explorer",
    category: "Repository",
    defaultBinding: "mod+shift+f",
  },
  {
    id: "open-in-editor",
    label: "Open in external editor",
    category: "Repository",
    defaultBinding: "mod+shift+a",
  },
  {
    id: "view-on-github",
    label: "View on GitHub",
    category: "Repository",
    defaultBinding: "mod+shift+g",
  },
  {
    id: "star-repository",
    label: "Star or unstar repository",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "create-issue",
    label: "Create issue on GitHub",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "create-local-issue",
    label: "Create local issue",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "create-discussion",
    label: "Create discussion",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "create-release",
    label: "Create release",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "create-tag",
    label: "Create tag",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "repository-statistics",
    label: "Repository statistics",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "manage-files",
    label: "Manage repository files",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "automations",
    label: "Automations",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "repository-settings",
    label: "Repository settings",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "branch-rules",
    label: "Branch rules",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "git-hooks",
    label: "Git hooks",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "submodules",
    label: "Submodules",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "change-remote-url",
    label: "Change remote URL",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "fork-repository",
    label: "Fork repository",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "repo-alias",
    label: "Create or change alias",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "copy-repo-path",
    label: "Copy repository path",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "remove-repository",
    label: "Remove repository",
    category: "Repository",
    defaultBinding: null,
  },
  {
    id: "new-repository",
    label: "New repository",
    category: "Repository",
    defaultBinding: "mod+n",
  },
  {
    id: "add-local-repository",
    label: "Add local repository",
    category: "Repository",
    defaultBinding: "mod+o",
  },
  {
    id: "clone-repository",
    label: "Clone repository",
    category: "Repository",
    defaultBinding: "mod+shift+o",
  },

  // Branches & stash
  {
    id: "new-branch",
    label: "New branch",
    category: "Branches & stash",
    defaultBinding: "mod+shift+n",
  },
  {
    id: "rename-branch",
    label: "Rename current branch",
    category: "Branches & stash",
    defaultBinding: "mod+shift+r",
  },
  {
    id: "delete-branch",
    label: "Delete current branch",
    category: "Branches & stash",
    defaultBinding: "mod+shift+d",
  },
  {
    id: "update-from-default",
    label: "Update from default branch",
    category: "Branches & stash",
    defaultBinding: "mod+shift+u",
  },
  {
    id: "merge-into-current",
    label: "Merge into current branch",
    category: "Branches & stash",
    defaultBinding: null,
  },
  {
    id: "squash-merge-into-current",
    label: "Squash and merge into current branch",
    category: "Branches & stash",
    defaultBinding: null,
  },
  {
    id: "rebase-current",
    label: "Rebase current branch",
    category: "Branches & stash",
    defaultBinding: null,
  },
  {
    id: "stash-all",
    label: "Stash all changes",
    category: "Branches & stash",
    defaultBinding: "mod+shift+s",
  },
  {
    id: "pop-stash",
    label: "Pop latest stash",
    category: "Branches & stash",
    defaultBinding: null,
  },
  {
    id: "view-stashes",
    label: "View stashes",
    category: "Branches & stash",
    defaultBinding: null,
  },
  {
    id: "discard-all",
    label: "Discard all changes",
    category: "Branches & stash",
    defaultBinding: null,
  },

  // Changes
  {
    id: "commit",
    label: "Commit",
    category: "Changes",
    defaultBinding: "mod+enter",
  },
  {
    id: "generate-commit-message",
    label: "Generate commit message (AI)",
    category: "Changes",
    defaultBinding: "mod+g",
  },
  {
    id: "undo-commit",
    label: "Undo last commit",
    category: "Changes",
    defaultBinding: "mod+z",
  },
  {
    id: "stage-all",
    label: "Stage all changes",
    category: "Changes",
    defaultBinding: null,
  },
  {
    id: "unstage-all",
    label: "Unstage all changes",
    category: "Changes",
    defaultBinding: null,
  },

  // Agent (only live on the Agent tab, which exists when AI features are on)
  {
    id: "agent-new-session",
    label: "New agent session",
    category: "Agent",
    defaultBinding: null,
  },
  {
    id: "agent-keep-session",
    label: "Keep agent session",
    category: "Agent",
    defaultBinding: null,
  },
  {
    id: "agent-discard-session",
    label: "Discard agent session",
    category: "Agent",
    defaultBinding: null,
  },
  {
    id: "agent-resume-session",
    label: "Resume agent session",
    category: "Agent",
    defaultBinding: null,
  },
  {
    id: "agent-delete-session",
    label: "Delete agent session",
    category: "Agent",
    defaultBinding: null,
  },
  {
    id: "agent-toggle-view",
    label: "Toggle conversation / changes",
    category: "Agent",
    defaultBinding: null,
  },

  // Pull requests
  {
    id: "create-pr",
    label: "Create pull request",
    category: "Pull requests",
    defaultBinding: "mod+r",
  },
  {
    id: "create-local-pr",
    label: "Create local pull request",
    category: "Pull requests",
    defaultBinding: null,
  },
] as const satisfies readonly ActionDef[];

export type ActionId = (typeof ACTIONS)[number]["id"];

export const CATEGORY_ORDER: ActionCategory[] = [
  "Application",
  "Navigation",
  "Repository",
  "Branches & stash",
  "Changes",
  "Agent",
  "Pull requests",
];

/**
 * Fixed keys that aren't actions and can't be rebound — shown in the cheat
 * sheet's "Built-in" section so the documentation is complete.
 */
export const BUILT_IN_KEYS: {
  keys: string;
  what: string;
  /** Canonical binding, formatted per-platform at render (⌘ on macOS). When set,
   *  it supersedes the literal `keys` display string. */
  binding?: string;
}[] = [
  {
    keys: "↑ / ↓",
    what: "Move through lists (files, commits, PRs, repositories)",
  },
  { keys: "Shift+↑ / Shift+↓", what: "Extend the selection in History" },
  { keys: "Enter", what: "Open or select the highlighted item" },
  { keys: "Esc", what: "Close dialogs, menus, and settings" },
  {
    keys: "Ctrl+Enter",
    what: "Submit a PR comment from its text box",
    binding: "mod+enter",
  },
];
