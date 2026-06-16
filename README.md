# GitDesktop

**An AI-native, keyboard-first Git desktop client.** GitDesktop takes GitHub
Desktop's approachable model further: the entire pull-request lifecycle in the
app (including offline "local" PRs), a GitHub Actions cockpit, AI woven through
commits, reviews, and CI debugging with your choice of provider — including
fully-local models — and a completely rebindable keyboard layer.

Built with **Tauri 2 + React 19**. All GitHub access goes through the **GitHub
CLI (`gh`)** — there's no OAuth app and the app never stores your tokens. Core
git works against any remote via system `git`.

> Runs on Windows and Linux today (macOS planned).
<!-- See
> [github-desktop.md](github-desktop.md) for a full, honest feature-by-feature
> comparison with GitHub Desktop. -->

## Highlights

- **The whole PR lifecycle, in-app** — review, comment, label, approve, edit,
  and merge (merge/squash/rebase) GitHub PRs without the browser. Plus **local
  PRs**: the same workflow against any two branches with no remote at all,
  promotable to a real GitHub PR in one click.
- **GitHub Actions cockpit** — browse workflow runs, drill into jobs and steps,
  re-run (all or failed), cancel, manually dispatch a workflow, and read
  failed-step logs — none of which GitHub Desktop does.
- **Debug failed CI with AI** — turn a failed job's logs into a streamed
  root-cause + fix, ending with a ready-to-paste prompt for a coding agent.
- **AI where it helps** — commit messages, PR titles/descriptions, and a
  streaming code review or security audit, from Anthropic, OpenAI, OpenRouter,
  local **Ollama**, or **keyless CLI agents** (Claude Code / Codex via your
  existing subscription — no API key).
- **Privacy-first** — API keys live in the OS keychain (never in app files),
  local models keep code on your machine, AI-ignore patterns keep sensitive
  files out of context, and a single switch hides every AI surface.
- **Keyboard-first** — rebindable shortcuts with GitHub-Desktop-compatible
  defaults, a generated cheat sheet (Ctrl+/), a command palette (Ctrl+K), and
  arrow-key navigation everywhere.
- **Self-updating** — signed, verified auto-updates from GitHub Releases, with
  install always on your consent.

## Features

**Repositories** — clone, add local, create (README / .gitignore / license
scaffolding), publish to GitHub, and fork. A header repo switcher groups every
repo by owner with a Recent section and filter; aliases, repository statistics
(languages, contributors, sizes, branch-vs-default stats), and recycle-bin-safe
removal.

**Changes & commits** — unified/split diff with syntax highlighting and image
diffing; filter the changes list by path or category; hunk-level staging;
stage/unstage/discard single files or a multi-selection from the context menu;
discarding an untracked file goes to the recycle bin. Commit with title + body,
co-authors suggested from history, amend, undo, reset, and revert.

**Branches** — switch (bring-changes / stash prompt), create, rename, delete,
and **archive** (hide from the switcher without deleting). Per-branch ahead/behind
vs. the default branch, update a branch *without* checking it out, a Compare tab
(three-dot diff, commits ahead/behind, merge/rebase, jump to PR), and **local
branch-protection rules** (naming, merge methods, require-PR, force-push) that
are shareable via a committed file or importable from GitHub.

**History & advanced** — paged, filterable history; rich commit detail; cherry-pick
(onto the current or another branch), squash and reorder unpushed commits behind
an atomic replay engine, a stash browser, and tag management.

**Syncing** — fetch / pull / push with ahead/behind indicators; pull is
`--ff-only`, and divergence routes to a guarded force push with
`--force-with-lease`. In-progress merge/rebase/cherry-pick get a conflict banner
with gated Continue / Abort.

**Pull requests** — full read + write for GitHub PRs and local PRs (see
Highlights), AI review + security audit on any PR, and Write/Preview markdown
everywhere you author.

**GitHub Actions** — a dedicated tab with live run status, run detail, re-run /
cancel / manual dispatch, inline failed-step logs, **Debug with AI**, a current-branch
CI badge in the header, and run-completion notifications.

**Git hooks** — view, edit, enable/disable, and template `.git/hooks`, with
husky / pre-commit / lefthook detection and install integration.

**Automations** — rules like "on PR open → run AI review + security audit," with
global defaults and per-repo overrides.

**Integrations** — open in any editor or terminal (auto-detected, or point at any
executable), and tunable OS notifications for PR activity, checks, and CI runs.

## AI configuration

- **Providers** — Anthropic, OpenAI, OpenRouter, local **Ollama**, and the
  **Claude Code / Codex CLIs** (keyless, via your subscription). Separate models
  for generation vs. review; live model lists in a searchable picker.
- **Custom instructions** (included in every generation):
  - **Global** — Settings → AI instructions (e.g. "Follow Conventional Commits").
  - **Per-repo** — `.gitdesktop/instructions.md` in the repo. Takes precedence.
- **AI ignore patterns** (keep files out of AI context; they still commit
  normally), gitignore-style:
  - **Global** — Settings → Excluded files (one pattern per line).
  - **Per-repo** — `.gitdesktop/aiignore` in the repo.
- **Keys** live in the OS keychain (Windows Credential Manager, macOS Keychain,
  libsecret). **Hide AI** (Settings → General) hides every AI surface while
  keeping your config.

## Updates

GitDesktop checks GitHub Releases on launch (opt-out in Settings → Updates) and
installs **only on your consent**. Updates are cryptographically signed and
verified by the app — separate from OS code signing. Maintainer release steps:
[docs/deployment-updates.md](docs/deployment-updates.md).

## Requirements

- **git** on `PATH` (required).
- **GitHub CLI (`gh`)**, installed and authenticated (`gh auth login`), for the
  pull-request and Actions features — they stay hidden when it isn't available.
- An **AI provider** for the AI features: an API key (Anthropic / OpenAI /
  OpenRouter), a local **Ollama** server, or a signed-in **Claude Code / Codex**
  CLI. All optional.

## Development

Prereqs: Rust toolchain, Node 20+, pnpm.

```sh
pnpm install
pnpm tauri dev    # run the app
pnpm build        # typecheck + bundle the frontend
pnpm lint         # biome
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
```

### Architecture

- `src-tauri/src/git/` — typed Tauri commands that shell out to system `git`
  (porcelain v2 parsing, per-repo mutation locks, timeouts).
- `src-tauri/src/github/` — `gh`-backed commands: pull requests (`pr.rs`) and
  GitHub Actions (`actions.rs`).
- `src-tauri/src/{hooks,secrets,instructions}.rs` — git-hook management, OS
  keychain storage, and repo instruction/rule files.
- `src-tauri/src/agent.rs` — drives local coding-agent CLIs (Claude Code / Codex)
  for keyless AI review and CI debugging.
- `src/lib/` — invoke bindings + TanStack Query hooks (`git/`, `github/`),
  the AI layer (`ai/`, Vercel AI SDK over the Tauri HTTP plugin so requests
  bypass webview CORS), settings, and the hotkey registry.
- `src/features/` — the screens: repository, changes/diff, commit, history,
  compare, pulls, actions, hooks, branch-rules, settings, and updates.

<!-- For the full GitHub Desktop comparison and remaining gaps, see
[github-desktop.md](github-desktop.md). -->
