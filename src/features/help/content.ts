/** A section of the in-app user guide, rendered as Markdown in the Help screen. */
export interface GuideSection {
  id: string;
  /** Left-nav label. */
  label: string;
  /** Markdown body. */
  body: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "getting-started",
    label: "Getting started",
    body: `# Welcome to GitDesktop

GitDesktop is a desktop Git client that aims to make everyday Git approachable
while going well beyond the basics — the full pull-request lifecycle, GitHub
Actions, and AI assistance, all in one app.

A few things worth knowing up front:

- **Git is required.** GitDesktop drives your system \`git\`, so anything it does
  is standard Git you could do on the command line.
- **GitHub features use the GitHub CLI (\`gh\`).** Pull requests and Actions appear
  once \`gh\` is installed and you've run \`gh auth login\`. There's no separate
  sign-in, and the app never stores your tokens. Plain Git (clone/fetch/pull/push)
  works against any remote without GitHub.
- **AI is optional.** Commit messages, PR descriptions, reviews, and CI debugging
  can use Anthropic, OpenAI, OpenRouter, Ollama (local or cloud), or the Claude
  Code / Codex CLIs. You can also hide every AI feature in Settings.

## Open your first repository

From the welcome screen (or the repo switcher in the header):

- **Open repository** — point at a folder that's already a Git repo.
- **Clone repository** — clone from a URL, or browse your GitHub repos.
- **Create repository** — start a new repo with an optional README, \`.gitignore\`,
  and license.

Once a repo is open you'll land on the **Changes** tab. The left sidebar's tabs —
Changes, History, Compare, Pull Requests, and Actions — are the five main views.

> Tip: press **Ctrl + K** anytime for the command palette, or **F1** to reopen
> this guide.`,
  },
  {
    id: "repositories",
    label: "Repositories",
    body: `# Repositories

## Switching repos

The repository name in the header is a **switcher**. Click it to see every repo
you've opened, grouped by GitHub owner, with a Recent section and a filter box —
jump between repos without returning to the welcome screen.

## The repository menu

Click the **⋯** menu next to the repo name for repo-wide actions:

- **View on GitHub**, open a terminal at the repo root, show in your file manager,
  or open in your configured editor.
- **Publish repository…** — for a repo with no remote, create the GitHub repo,
  wire up \`origin\`, and push, in one step.
- **Fork**, change the remote URL, repository **statistics**, branch **rules**,
  git **hooks**, set an **alias**, and remove the repo from the list.

## Aliases & statistics

- An **alias** gives a repo a friendly name shown in the lists, header, and window
  title (handy when you have several repos with similar names).
- **Repository statistics** shows commits, contributors, branch/tag counts, sizes,
  a language-makeup bar, and how the current branch compares to the default.`,
  },
  {
    id: "changes",
    label: "Changes & commits",
    body: `# Making changes & committing

The **Changes** tab lists your modified files, split into **Staged** (included in
the next commit) and **Changes** (not yet staged).

## Staging

- Click a file to see its diff. Toggle **unified / split** at the top of the diff.
- Stage or unstage a file with the **+ / −** button on its row, or **Stage all**.
- **Hunk-level staging**: in a file's diff, each hunk has its own Stage / Unstage /
  Discard buttons.
- Select multiple files (Ctrl/Cmd-click, or Shift-click for a range), then
  right-click for **Stage / Unstage / Discard / Stash** of the whole selection.
- Filter the list by path, or by category (new / modified / deleted, included /
  excluded) with the funnel button.

## Committing

Write a **summary** (there's a 72-character budget indicator) and an optional
**description**, then **Commit** (or **Ctrl + Enter**).

- **Co-authors** — add collaborators; the picker suggests people from the repo's
  history and writes proper \`Co-authored-by:\` trailers.
- **Generate with AI** — write the summary and description from your staged diff
  (see the AI section).
- After committing, **Undo** reverses the last commit and returns your message to
  the box. Right-click any commit in History for amend, revert, reset, and more.

> Discarding an **untracked** file moves it to the recycle bin, so it's
> recoverable — it isn't deleted outright.`,
  },
  {
    id: "branches",
    label: "Branches",
    body: `# Branches

The branch name in the header opens the **branch switcher**.

- Branches are sorted by most recent commit, with the default branch pinned on
  top and each branch's ahead/behind counts vs. the default.
- **Create** a branch (off the current or default branch), **rename**, **delete**,
  or **archive** it. Archiving hides a branch from the list without deleting it —
  archived branches collapse into an "Archived" section at the bottom.
- Switching with **uncommitted changes** prompts you to bring them along or stash
  and switch.
- Right-click a branch to **update it from the default branch** (merge or rebase)
  *without* checking it out.

## Compare

The **Compare** tab lets you pick any base branch and see what the current branch
adds: the commits ahead and behind, and the full three-dot diff a PR would show.
From here you can merge, rebase, or jump straight to opening a pull request.

## Branch rules

**Branch rules…** (in the ⋯ menu) sets local protections — naming patterns,
blocked deletion, allowed merge methods, require-PR, and force-push blocking.
They're enforced inside the app, can be shared with your team via a committed
file, and can be imported from a repo's GitHub branch-protection rules.`,
  },
  {
    id: "syncing",
    label: "Syncing",
    body: `# Fetch, pull, and push

The header shows **Fetch / Pull / Push** with ahead/behind indicators.

- **Fetch** (F5) updates your view of the remote without changing your branch.
- **Pull** is fast-forward only by design — it won't create surprise merge commits.
- **Push** sends your commits. For a branch with no upstream yet, you'll see
  **Publish branch** instead.

## Safer force push

If your local history was rewritten (for example, after amending a commit that was
already pushed), GitDesktop detects the divergence and turns Push into a
**confirmed force push using \`--force-with-lease\`** — which refuses to clobber
work someone else pushed in the meantime.

## Conflicts

During a merge, rebase, or cherry-pick, a banner appears in **Changes** with the
conflicted-file count. Resolve each conflict in your editor and stage it (the
\`!\` badge clears as files are resolved), then **Continue** — or **Abort** to back
out. Continue stays disabled until every conflict is resolved.`,
  },
  {
    id: "pull-requests",
    label: "Pull requests",
    body: `# Pull requests

The **Pull Requests** tab manages both GitHub PRs and local PRs. (GitHub PRs need
\`gh\` installed and authenticated.)

## GitHub PRs

Browse open/closed PRs and open one in a full in-app view: description, commits,
changed files with diffs, and CI checks. From there you can **comment** (with
quote-reply), **review** (approve / comment / request changes), **edit** the title
and body, manage **labels**, mark a draft **ready**, **merge** (merge commit,
squash, or rebase, with optional branch deletion), and **close**.

Create a PR with **New → Pull request on GitHub** (or from the Compare tab),
optionally with an **AI-generated** title and description from the branch diff.

## Local PRs

A **local PR** is the same review workflow against any two branches with **no
remote at all** — describe it in Markdown, comment, label, approve, and merge
locally. Local PRs are private to you and never written into the repo. When you're
ready, **promote** a local PR to a real GitHub PR in one click.

## AI review

On any PR, run a streamed **code review** or a focused **security audit** of its
changes using your chosen review model, and optionally post the result as a
comment. See the AI section to pick the review model.`,
  },
  {
    id: "actions",
    label: "GitHub Actions",
    body: `# GitHub Actions

The **Actions** tab is a cockpit for your GitHub Actions workflow runs (needs
\`gh\` + a GitHub remote).

- The list shows recent runs with live status, refreshing while any run is active.
  Filter by text or scope to the current branch.
- Click a run to see its **jobs and steps** with status and durations.
- **Re-run all jobs**, **Re-run failed jobs**, or **Cancel** an in-progress run.
- **Run workflow…** manually dispatches a workflow (one with a
  \`workflow_dispatch\` trigger) on a branch you choose, with optional inputs.
- For a failed job, expand **failed-step logs** inline.

## Debug with AI

On a failed job, **Debug with AI** reads that job's logs and streams a diagnosis:
the likely **root cause**, a concrete **fix**, and — at the end — a ready-to-paste
**agent prompt** you can hand to a coding agent (like Claude Code or Codex) to
implement the fix. Copy just that prompt with **Copy fix prompt**.

A small **CI badge** in the header tracks the current branch's latest run; click it
to jump to that run. You can also get a notification when a run finishes
(Settings → Notifications).`,
  },
  {
    id: "ai",
    label: "AI features",
    body: `# AI features

GitDesktop uses AI for commit messages, PR titles/descriptions, PR reviews, and CI
debugging. It's entirely optional — and configurable in **Settings → AI**.

## Providers

Bring your own model:

- **Anthropic, OpenAI, OpenRouter, Ollama Cloud** — paste an API key (stored in
  your OS keychain, never in app files).
- **Ollama (local)** — a fully local model, so your code never leaves your machine.
- **Claude Code / Codex CLIs** — *keyless*: they reuse your existing CLI
  subscription login, with no API key. Used for review and CI debugging, and can
  read repo files for deeper context.

You can set **separate models** for generation (commit/PR messages) versus review.

## Instructions & privacy

- **Instructions** steer every generation. Set **global** instructions in Settings
  (e.g. "Follow Conventional Commits"), or add a per-repo
  \`.gitdesktop/instructions.md\` that takes precedence.
- **AI-ignore patterns** keep sensitive or noisy files (lockfiles, vendored
  folders) out of the AI's context while still committing them normally — global in
  Settings, or per-repo via \`.gitdesktop/aiignore\`.
- **Hide AI** (Settings → General) removes every AI surface from the app while
  keeping your configuration, for when you'd rather not see it.`,
  },
  {
    id: "hooks",
    label: "Git hooks",
    body: `# Git hooks

**Git hooks…** (in the repo ⋯ menu) manages the scripts in your repo's
\`.git/hooks\` — the small programs Git runs at points like *before commit* or
*before push*.

- See every hook with its state (active / disabled / inactive) and **edit** it in
  a built-in editor.
- **Enable or disable** a hook without deleting it, or delete it outright.
- **Templates** give you a one-click starting script for any of the standard hooks
  (pre-commit, commit-msg, pre-push, …).
- If your repo uses a hook manager — **husky**, **pre-commit**, or **lefthook** —
  GitDesktop detects it, opens its config, and can run the right install/update
  command for you.`,
  },
  {
    id: "keyboard",
    label: "Keyboard & navigation",
    body: `# Keyboard & navigation

GitDesktop is built to be driven from the keyboard.

- **Command palette — Ctrl + K.** Search and run any action available right now.
  The fastest way to find a feature when you don't know where it lives.
- **Keyboard shortcuts — Ctrl + /.** A cheat sheet of every shortcut, always
  reflecting your customizations.
- **Arrow keys** navigate every list (files, commits, branches, PRs, runs);
  Shift+Arrow extends a selection.
- Switch tabs with **Ctrl + 1–5** (Changes, History, Compare, Pull Requests,
  Actions). **Ctrl + ,** opens Settings; **F1** opens this guide.

Every shortcut is **rebindable** in **Settings → Keyboard**: click a binding,
press a new combination, and if it clashes with another action the app moves it
for you. Defaults match GitHub Desktop where there's an equivalent.`,
  },
  {
    id: "settings",
    label: "Settings & updates",
    body: `# Settings & updates

Open **Settings** from the header gear (or **Ctrl + ,**). Highlights:

- **AI** — providers, models, keys, and instructions.
- **Notifications** — opt into OS notifications (sent only when the window isn't
  focused) for PR activity, CI checks, reviews on your PRs, and workflow runs
  finishing.
- **Keyboard** — rebind any shortcut.
- **External editor / Terminal** — auto-detected, or point at any executable. These
  power the "Open in…" actions throughout the app.
- **Git** — the default branch name for new repos and your global Git identity.
- **General** — hide AI features.

## Staying up to date

GitDesktop updates itself from GitHub Releases. On launch it checks for a newer
version (you can turn this off in **Settings → Updates**) and, when one exists,
offers to **install on your consent** — it never updates silently. Updates are
cryptographically signed and verified by the app. You can also check anytime with
**Check for updates now**.`,
  },
];
