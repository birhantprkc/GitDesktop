# Changelog

All notable, user-facing changes to GitDesktop are recorded here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are curated for humans. They're drafted from the commit history
(`pnpm changelog`) and then rewritten into clear, user-facing notes — not a raw
commit list.

## [Unreleased]

### Added

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

### Fixed

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
