# Changelog

All notable, user-facing changes to GitDesktop are recorded here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are curated for humans. They're drafted from the commit history
(`pnpm changelog`) and then rewritten into clear, user-facing notes — not a raw
commit list.

## [Unreleased]

First release. GitDesktop is an AI-native, keyboard-first desktop Git client
built on Tauri 2; every GitHub feature runs through the GitHub CLI (`gh`).

### Added

- **Repositories** — clone, add a local repo, create one (with README,
  `.gitignore` template, and license scaffolding), publish to GitHub, and fork.
  A header repo switcher groups every repo by owner with a Recent section and a
  filter; repositories support aliases, repository and branch statistics, and
  recycle-bin-safe removal.
- **Changes & commits** — a unified/split diff viewer with syntax highlighting
  and image diffing; filter the changes list by path or category; hunk-level
  staging; stage, unstage, or discard single files or a multi-selection from the
  context menu; untrack tracked files; and recycle-bin-safe discard. Commit with
  a 72-character title budget, co-authors suggested from history, amend, undo,
  reset, and revert.
- **AI assistance** — streamed commit messages and pull-request
  titles/descriptions, plus a code review or focused security audit on any PR.
  Bring your own provider: Anthropic, OpenAI, OpenRouter, local **Ollama**, or
  **keyless Claude Code / Codex CLI agents**. Global and per-repo instructions,
  gitignore-style AI-ignore patterns, and a single switch to hide every AI
  surface. API keys are stored in the OS keychain.
- **Branches** — create, switch (with a bring-changes / stash prompt), rename,
  delete, and **archive** (hide from the switcher without deleting). Per-branch
  ahead/behind counts, updating a branch without checking it out, a Compare tab
  (three-dot diff, commits ahead/behind, merge/rebase), and local
  branch-protection rules (naming, merge methods, require-PR, force-push) that
  can be shared via a committed file or imported from GitHub.
- **History & advanced git** — paged, filterable history; a rich commit detail
  view; cherry-pick onto the current or another branch (including a
  multi-selection); squash and reorder unpushed commits through an atomic replay
  engine; a stash browser; and tag management.
- **Syncing** — fetch, pull, and push with ahead/behind indicators. Pull is
  `--ff-only`, and divergence routes to a guarded force push with
  `--force-with-lease`; an in-progress merge/rebase/cherry-pick shows a conflict
  banner with gated Continue and Abort.
- **Pull requests** — the full lifecycle in-app for GitHub PRs (comment, review,
  edit title/body, manage labels, merge with merge/squash/rebase, draft → ready,
  close) and for **local PRs** — the same workflow against any two branches with
  no remote, promotable to a real GitHub PR in one click.
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

### Fixed

- Diff-renderer exceptions are caught by an error boundary instead of taking
  down the whole app.

[Unreleased]: https://github.com/theBGuy/GitDesktop/commits/main
