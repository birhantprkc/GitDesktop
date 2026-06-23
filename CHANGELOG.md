# Changelog

All notable, user-facing changes to GitDesktop are recorded here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are curated for humans. They're drafted from the commit history
(`pnpm changelog`) and then rewritten into clear, user-facing notes — not a raw
commit list.

## [Unreleased]

### Changed

- **Subtle, calm transitions in a few spots.** A handful of state changes now ease
  in instead of popping: the Send/Stop, Generate/Cancel, and Review/Cancel buttons
  when an AI task starts or stops; agent sessions sliding in and out of the list as
  you start, keep, or delete them; the "jump to latest" button in an agent chat;
  the ahead/behind badges in the toolbar; and a soft fade as the Changes list
  replaces its loading placeholder. Everything respects your system "reduce motion"
  setting (it falls back to a plain fade or no animation).

### Fixed

- **Rust diffs no longer lose syntax highlighting partway down a file.** A large
  Rust diff could render the top of a file highlighted and everything past a
  certain line as plain text — a quirk of the lightweight highlighter mis-reading
  a character literal or lifetime and giving up on the rest of the file. Rust now
  renders with the same VS Code-grade grammar already used for TypeScript, Vue,
  and others, which highlights every line reliably.

### Added

- **Delegate a task to an AI agent, and iterate with it (agent sessions).** A new
  **Agent** tab lets you hand a coding task to an AI agent that writes the code for
  you. It runs full-auto inside an isolated, throwaway git worktree — a separate
  checkout, so your working tree, staged changes, and current branch are never
  touched no matter what the agent does. For stronger confinement you can opt
  into running each session inside an **ephemeral Docker/Podman container**
  (Settings → AI), so the agent's filesystem writes are limited to the worktree
  by the kernel — GitDesktop builds the small agent image for you. It's a
  **conversation**: watch the agent
  work as its narration streams into the conversation, then send follow-ups ("now
  also handle the empty case", "undo that part") and it keeps going with full
  context — each turn becomes a reviewable checkpoint commit. The composer stays
  pinned while output streams (it grows as you type, then scrolls), Enter sends
  and Shift+Enter adds a line, and a **Latest** button jumps you back to the
  newest output if you've scrolled up. **Press ↑/↓ to recall your previous
  prompts** (like a terminal), and any turn that came back empty or errored
  offers **Edit & resend** to pull its prompt back into the composer and retry.
  Type **`@` to reference a repo file**, and **file paths the agent mentions are
  clickable** — they open in your editor. Flip
  between the **Conversation** and a dedicated **Changes** view (the full diff so
  far) right in the session. Pick the **model** for the session (changeable as you
  go). **Run
  several sessions at once** — each gets its own worktree and runs independently,
  listed in the sidebar so you can start one, switch to another while it works
  (arrow keys included), and come back. The sidebar groups sessions into
  **Active** and **Kept** tabs (with counts) so finalized work doesn't crowd
  what's ready to review, and a **search** box filters by task, branch, or any
  message. An **OS notification** fires when a turn finishes — unless you're
  already watching that session — so you can start one and step away. **Sessions
  are remembered across
  restarts** — close and reopen the app and your sessions are still there, ready
  to keep iterating (a follow-up picks up right where it left off). When you're
  happy, **Keep** the work — optionally squashing the per-turn commits into one —
  and it lands on its own branch ready to open as a PR. **Kept sessions stay in
  the list**, so you can come back later: **Resume** re-opens one and continues
  the conversation right where it left off, or **Delete** removes it from the app
  (the branch is preserved). **Discard** throws an in-progress session away
  entirely (branch and all). New session, Keep, Resume, Delete, Discard, and the
  view toggle are all in the command palette and keyboard-bindable. It
  builds on the CLI agent you already have — **Claude Code** or **Codex** (pick
  it per session — Codex confines its own writes to the worktree with its OS
  sandbox, so it needs no Docker; the container is an optional stronger boundary) —
  no separate subscription, and only appears when AI features are enabled.
- **Commit — or discard — part of a brand-new file.** Line- and hunk-level
  staging now works on untracked (new) files too, not just files git already
  tracks — drag across the lines you want in a new file's diff and stage just
  those, leaving the rest for a later commit. (Previously a new file could only
  be staged whole.) The unstaged remainder keeps showing as you go. Discarding a
  new file's lines works the same way: drag (or use a hunk's Discard) to drop
  just those lines from the file — discarding the whole new file still goes to
  the recycle bin.
- **See what you haven't pushed.** The History list now marks every commit that
  isn't on the remote yet with a small up-arrow (hover for "ahead of
  origin/…") — so it's clear at a glance what a push would send. On a branch
  with no upstream, every commit is marked until you publish it. The markers
  clear themselves once the push lands.
- **Reviews build on other AI reviewers.** If GitHub Copilot, CodeRabbit, or
  another review bot has already weighed in on a GitHub pull request, an AI
  review or security audit now folds their findings — including their
  line-anchored inline comments — in as soft context, the same way it builds on
  your own previous review. So instead of starting cold, your review begins from
  what's already been flagged and re-verifies each point against the current diff
  (their findings are treated as hints, never fact): it confirms the real ones
  (crediting the bot when they match), and — most usefully — briefly calls out
  the ones that are wrong or already fixed, triaging their false positives for
  you instead of silently dropping them. It only pulls from recognized code-review
  bots — deploy and CI bots are ignored — notes when a finding was made against
  an older commit, and a per-PR banner lets you opt out for a clean pass.
- **Copy an AI review without posting it.** The PR review panel now has a
  **Copy** button next to "Post as comment," so you can grab the review (or
  security audit) as markdown for use elsewhere without having to post it to the
  pull request first.
- **Insights tab.** A new **Insights** tab (Ctrl/Cmd-9, or "Insights…" in the
  repository menu) with a GitHub-style board of repository graphs. Four of them —
  **commit activity** (per week), **code frequency** (additions vs. deletions per
  week), **contributors** (commits + line churn), and a **punch card** (commits by
  day-of-week × hour) — are computed **locally from your clone**, so they work
  offline, on private repos, with no token or rate limit, and without GitHub's
  10,000-commit chart degradation. Alongside them: the at-a-glance **overview**
  (commits, contributors, languages, sizes — the old "Repository statistics"
  dialog, now folded in), a **GitHub Actions** success-rate and run-duration
  trend computed from runs already fetched, and a **community-health** card
  (stars, forks, watchers, README/license/templates). It also surfaces repository
  **traffic** (14-day views, clones, referrers, and popular paths — when you have
  push access), a searchable **dependencies** card from the dependency graph
  (direct vs. transitive, each linking to its registry with a description on
  hover), and quick links to the insights GitHub only renders on the web (Pulse,
  network graph, forks, dependents, Actions usage/performance, stars over time).
  Every chart ships a one-line caption, a data-table fallback, and keyboard
  navigation.

- **Manage repository files beyond pending changes.** A new **Manage files…**
  entry in the repository menu opens a dialog with two tabs. **Tracked** lists
  every file git tracks so you can untrack one that was committed by mistake —
  it stays on disk and is added to `.gitignore` so it doesn't come back.
  **Ignored** lists every file an ignore rule is hiding, showing the exact rule
  (`.gitignore:line · pattern`) responsible — so you can **force-add** a file
  that's ignored by mistake, or **remove the rule** that's ignoring it. Both
  tabs are filterable, virtualized for huge repos, multi-select (with arrow-key
  and Shift-range keyboard navigation), and confirm before anything that touches
  `.gitignore` or the index.

- **More of the app is reachable from the keyboard.** The command palette
  (Ctrl/Cmd-K) and Settings → Keyboard now include the repository-menu actions
  that were previously click-only: **manage files**, **star / unstar**,
  **repository settings**, **branch rules**, **git hooks**, **submodules**, and
  **copy repository path** — each respecting the same availability as its menu
  item, and rebindable like every other shortcut.

- **Ignore or untrack multiple files at once.** Select several files in the
  Changes list (Ctrl/Cmd-click or Shift-click) and the right-click menu now
  offers **Ignore N files** and **Untrack N files** alongside the existing bulk
  stage / discard / stash — previously these were single-file only. Untrack
  applies to the tracked files in the selection (kept on disk), and ignoring a
  batch skips any `.gitignore` lines that are already there.

- **Settings → About: a one-glance environment check.** A new **About** section
  shows your app, OS and Tauri versions plus a **Components** table for every
  command-line tool GitDesktop relies on — git, the GitHub and GitLab CLIs, and
  the Claude/Codex agent CLIs. Each row shows whether it's installed, its version
  and resolved path, and (where it applies) whether you're signed in — with a
  one-click **Install** link for anything that's missing. Several features quietly
  degrade when a CLI is absent or signed out; now the dependency is explicit.

- **Cleaner in-progress logs for GitHub Actions.** While a job is still running,
  its logs section now shows a tidy "logs appear when this job finishes" note
  with a **Watch live on GitHub** link — instead of GitHub's raw "still in
  progress" message (the API only serves a job's log once it's archived on
  completion). The moment the job finishes, its logs load in automatically — no
  need to reopen the section.

- **Syntax-highlighted code blocks in rendered markdown.** Fenced code blocks —
  in PR / issue / discussion descriptions and comments, AI review output, and
  release notes — are now syntax-highlighted with the GitHub color palette
  (light and dark), across ~190 languages. Language tags and common aliases
  (`ts`, `js`, `py`, `sh`, `yml`, `rs`…) are recognized; untagged or unknown
  blocks render as plain text, same as before.

- **Write/Preview markdown everywhere, with a formatting toolbar.** Every place
  you write markdown now has GitHub-style **Write / Preview** tabs and a
  formatting toolbar — pull request, issue and discussion comments and replies,
  comment edits, and release notes. The toolbar covers bold, italic, heading,
  quote, code, link, and bulleted / numbered / task lists, with `Ctrl+B`,
  `Ctrl+I` and `Ctrl+K` shortcuts; it wraps your current selection (or drops in
  a placeholder), and Preview renders exactly what the conversation will show.
  Rendered markdown also got a refresh — a clearer heading hierarchy with
  GitHub-style underlines, roomier spacing, and proper task-list checkboxes — so
  descriptions, comments and AI review output read the way they do on GitHub.

- **Iterative AI reviews that remember the last round.** When you re-run a code
  review or security audit on a pull request, it now builds on the previous
  one: the earlier findings and a diff of what changed since travel along as
  soft context, so the reviewer can confirm what you fixed (a "Resolved since
  last review" list) and stop re-raising the same points. The previous findings
  are treated as hints to re-verify, never as fact — the current diff stays the
  source of truth — and you stay in control: a per-mode banner lets you ignore
  the previous review for a clean pass, and a **Previous reviews** list lets you
  expand, trim a false finding before re-running, or delete past reviews. When a
  branch was rebased or the PR isn't checked out, it says so and falls back to a
  full review. Reviews that run automatically (via an automation rule) are
  remembered too, so a later manual re-run builds on them.
- **Auto re-review on new commits.** A new automation trigger, **"On new commits
  to a reviewed PR,"** watches the PRs you've already reviewed and re-runs the
  review automatically when you push new commits to one — building on the last
  review, so the new pass confirms what you fixed and focuses on what's new.
  It's opt-in per PR (it only re-reviews PRs you've reviewed at least once, not
  every open PR) and fires at most once per new head. Works for local PRs (the
  moment you commit) and for GitHub PRs (within a minute of a push) — including
  PRs whose branch isn't checked out locally. Add it under
  **Settings → Automations**.
- **Repo-aware CLI reviews read the right branch.** When a Claude Code / Codex
  review is set to read repo files for context, it now reviews the pull
  request's actual files even when that branch isn't the one you have checked
  out — GitDesktop spins up a throwaway, detached worktree at the PR's head for
  the duration of the review and cleans it up afterward, so your working branch
  never moves.
- **Close to tray / background running.** Closing the window now hides GitDesktop
  to the system tray and keeps it running, so a long AI review finishes in the
  background instead of being cut off — you get an OS notification when it's done
  and can reopen from the tray icon (right-click for Open / Quit). Prefer closing
  to quit? Turn off **Settings → General → "Keep running in the tray"**.
- **Ollama Cloud provider.** Alongside the local Ollama server, you can now use
  Ollama's hosted models (e.g. `gpt-oss:120b`, `qwen3-coder:480b`) with an API
  key from [ollama.com/settings/keys](https://ollama.com/settings/keys) — no
  local install required. The model picker lists the cloud catalog live, just
  like the other keyed providers.
- **Activity indicator for AI reviews.** A code review or security audit you
  start on a pull request no longer disappears when you switch the PR's sub-tab
  or open a different PR — it keeps running in the background, surfaced by a
  compact indicator that's hidden when nothing's happening: in the header while
  you're in a repository, and a thin strip along the bottom on the other
  screens. Open it to watch progress, cancel a run, or jump straight back to a
  finished review; the result is also waiting on the PR's Review panel when you
  return. Running reviews on several pull requests at once is paced to your
  hardware — cloud providers run many in parallel, while local CLI-agent and
  Ollama runs are capped more conservatively to your CPU — and any extras wait
  in a short queue and start automatically as running ones finish.

### Changed

- **The Insights tab does nothing until you open it.** Its repository scans and
  GitHub calls used to run in the background every time you opened a repository,
  even if you never visited the tab. They now start only when you first open
  Insights, so opening a repo is lighter.

- **Faster startup.** Analytics and the Insights charting library are no longer
  bundled into the initial app load — they load on demand (the charts the first
  time you open Insights), so the app starts quicker.

- **Staging is one whole-file view now.** The working-tree diff used to render
  each hunk as a separate card; it's now a single scrollable file view with full
  syntax highlighting and GitHub-style collapsible context — expand the unchanged
  lines around a change, then a "Collapse expanded context" control restores the
  original hunks. It keeps one-click Stage / Unstage / Discard per hunk and
  drag-to-stage for individual lines — which now spans the whole file, not just
  one hunk at a time.

### Fixed

- **The repository switcher no longer jumps when you open it.** The list groups
  your repositories by owner, and that grouping used to wait on a lookup that ran
  fresh each time the menu opened — so the list would briefly show ungrouped and
  then visibly reshuffle into its owner sections, occasionally moving a row out
  from under your cursor. Each repo's owner is now remembered, so the menu opens
  already grouped and stays put.

- **Diffs highlight with full-file context, and show expandable surrounding
  lines.** When a diff's first visible line landed in the middle of a multi-line
  comment, the code after the comment could be mis-colored (highlighted as if it
  were still inside the comment), because only the changed hunk — not the file
  around it — was handed to the highlighter. Commit, stash, new-file, and
  working-tree staging diffs now read the whole file for context, so highlighting
  is correct, and you can expand the unchanged lines above and below each change
  in place (GitHub-style), instead of just a fixed "Show full diff." Only very
  large files and truncated diffs keep the previous lightweight view.

- **Links to external pages use the pointer cursor.** Buttons and link-styled
  text that open something in your browser — the "GitHub" / "View on GitHub"
  buttons across pull requests, issues, discussions, tags, and the compare view;
  the issue sidebar's Projects/Notifications links; setup links (Download Git,
  Install GitHub CLI); the Settings privacy-policy and component-install links;
  the Actions step/run deep-links; and the linked-PR/issue rows — now show the
  hand (pointer) cursor on hover instead of the default arrow, so they read as
  the links they are. The link-styled in-app toggles (show/hide a hidden comment,
  show/hide archived, ignore a prior review) got the same treatment for
  consistency.

- **The Changes list stays fast (and stops crashing) on huge working trees.**
  Repositories with thousands of changed files used to bog down or crash the
  Changes tab. The list is now virtualized — only the visible rows are rendered —
  and the per-file right-click menu was consolidated into one shared menu instead
  of mounting a menu for every row. Selecting, filtering, and arrow-key
  navigation stay smooth no matter how many files have changed.

- **"Debug with AI" no longer cancels when you close the dialog.** The Actions
  failure-diagnosis used to stop and discard itself the moment you closed its
  window — so an accidental close threw away the analysis. Now closing just hides
  it: the run keeps streaming in the background and reopening shows the same
  (in-progress or finished) diagnosis. Only the explicit **Cancel** button stops
  a run.

- **The commit message clears instantly when you commit.** The title and
  description now empty the moment you hit Commit, instead of staying on screen
  until the commit finishes and then snapping blank — so a fast local commit
  feels snappy. If the commit fails, your message (and amend mode) comes back so
  nothing is lost.

- **Undo/redo now works in the markdown editor.** `Ctrl+Z` / `Ctrl+Y` (and
  `Ctrl+Shift+Z`) reliably undo and redo in every comment, reply, and
  description field — including formatting-toolbar actions (bold, lists, links),
  which previously couldn't be undone at all. Switching between the **Write** and
  **Preview** tabs no longer wipes your undo history either.

- **Settings → AI: "Test connection" now tests the key you've typed**, even
  before you save it — so you can verify a new API key before committing it to
  the keychain, instead of getting a "no key saved" error.

- **macOS: the Changes-list file actions use the right path.** Right-clicking a
  file and choosing **Copy file path**, **Show in Finder**, **Open in editor**,
  or **Open with default program** built a Windows-style path on macOS and
  failed. They now use the correct separator on every platform.

- **Line-by-line staging always targets the right hunk.** When two changed
  regions of a file happened to share an identical header line, selecting and
  staging individual lines could occasionally act on the wrong region. Each
  region now has a stable identity, so the lines you pick are the lines that
  stage.

- **Clearer message when AI needs a key.** Generating a pull-request description
  with AI now points you to **Settings → AI** when no API key is configured,
  instead of showing a generic error — matching the AI issue drafter.

## [0.1.0] - 2026-06-19

First release. GitDesktop is an AI-native, keyboard-first desktop Git client
built on Tauri 2; every GitHub feature runs through the GitHub CLI (`gh`).

### Added

- **Repositories** — clone, add a local repo, create one (with README,
  `.gitignore` template, and license scaffolding), publish to GitHub, and fork.
  A header repo switcher groups every repo by owner with a Recent section and a
  filter; repositories support aliases, repository and branch statistics, and
  recycle-bin-safe removal. Star or unstar a repo, and — as an admin — edit
  GitHub repo settings (description and topics with AI suggestions, merge options,
  and webhooks with delivery history) from the app.
- **Changes & commits** — a unified/split diff viewer with syntax highlighting
  and image diffing; filter the changes list by path or category; hunk- and
  line-level (drag-to-stage) staging; stage, unstage, or discard single files or
  a multi-selection from the
  context menu; untrack tracked files; and recycle-bin-safe discard. Commit with
  a 72-character title budget, co-authors suggested from history, amend, undo,
  reset, and revert; in-progress commit messages are preserved per repository and
  branch.
- **AI assistance** — streamed commit messages, branch names, pull-request and
  issue titles/descriptions (drafted from your issue templates), repository
  descriptions and topics, plus a code review or focused security audit on any PR.
  Bring your own provider: Anthropic, OpenAI, OpenRouter, local **Ollama**, or
  **keyless Claude Code / Codex CLI agents**. Global and per-repo instructions,
  gitignore-style AI-ignore patterns, and a single switch to hide every AI
  surface. API keys are stored in the OS keychain.
- **Branches** — create, switch (with a bring-changes / stash prompt), rename,
  delete, and **archive** (hide from the switcher without deleting). Per-branch
  ahead/behind counts and a PR badge in the switcher, updating a branch without
  checking it out, a Compare tab
  (three-dot diff, commits ahead/behind, merge/rebase), and local
  branch-protection rules (naming, merge methods, require-PR, force-push) that
  can be shared via a committed file or imported from GitHub.
- **History & advanced git** — paged, filterable history; a rich commit detail
  view; per-file history and line blame; cherry-pick onto the current or another
  branch (including a multi-selection); squash and reorder unpushed commits
  through an atomic replay engine; a stash browser; and submodule management.
- **Syncing** — fetch, pull, and push with ahead/behind indicators. Pull is
  `--ff-only`, and divergence routes to a guarded force push with
  `--force-with-lease`; an in-progress merge/rebase/cherry-pick shows a conflict
  banner with gated Continue and Abort.
- **Pull requests** — the full lifecycle in-app for GitHub PRs (comment, review,
  edit title/body, manage labels, merge with merge/squash/rebase, draft → ready,
  close) and for **local PRs** — the same workflow against any two branches with
  no remote, promotable to a real GitHub PR (comments included) in one click.
- **Issues & Discussions** — a tab for GitHub issues and private **local to-dos**
  (no remote needed; publishable to GitHub): browse, create, edit, and react;
  manage labels, assignees, milestones, issue type, sub-issues, dependencies
  (blocked-by / blocking), and development links (linked and closing PRs and
  branches, plus create-a-branch); and duplicate, transfer, pin, lock, or delete.
  A separate Discussions tab reads, creates, edits, reacts to, and upvotes a
  repository's GitHub Discussions.
- **Tags & releases** — a Tags tab listing every git tag with its GitHub release
  status (latest / pre-release / draft); create a tag, check it out, push, or
  delete it; and create, edit, publish, or delete GitHub releases with uploadable
  assets. Generate release notes from GitHub's commit-and-PR summary or with AI,
  with the previous tag resolved automatically (semver- and monorepo-aware) and
  a tabbed branch / recent-commit target picker.
- **GitHub Actions** — a dedicated tab listing workflow runs with live status; a
  run detail view with jobs and steps; re-run (all or failed), cancel, and
  manual workflow dispatch; inline failed-step logs; **Debug with AI**, which
  turns a failed job's logs into a root-cause + fix and a ready-to-paste agent
  prompt; a current-branch CI badge in the header; and run-completion
  notifications.
- **Git hooks** — view, edit, enable/disable, and template `.git/hooks`, with
  husky / pre-commit / lefthook detection and install integration.
- **Automations** — rules such as "on PR open → run AI review + security audit,"
  with global defaults and per-repo overrides.
- **Keyboard** — fully rebindable shortcuts with GitHub-Desktop-compatible
  defaults, a generated cheat sheet (Ctrl+/), a command palette (Ctrl+K), and
  arrow-key navigation across every list.
- **Integrations** — open in any editor or terminal (auto-detected or a custom
  executable path), and tunable OS notifications for pull-request activity,
  checks, and CI runs.
- **Auto-updates** — signed, verified updates from GitHub Releases, installed
  only on your consent, with an opt-out launch check.
- **Privacy & analytics** — anonymous, aggregate usage analytics (on by default,
  shown on first run with a one-switch opt-out; no source code, diffs, or commit
  content is captured) plus opt-in, masked session replay for diagnosing UI
  issues.

### Fixed

- Diff-renderer exceptions are caught by an error boundary instead of taking
  down the whole app.

[Unreleased]: https://github.com/theBGuy/GitDesktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/theBGuy/GitDesktop/releases/tag/v0.1.0
