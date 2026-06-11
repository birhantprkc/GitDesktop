# GitDesktop

An AI-native Git client: GitHub Desktop-style basics with provider-agnostic,
customizable AI commit message generation.

## Features (Milestone 1)

- Open, clone, or create repositories (README/gitignore-template/license
  scaffolding, configurable default branch name). A repo switcher in the
  header (and on the welcome screen) lists every repo you've opened, grouped
  by owner with a Recent shortcut — switch without leaving the current repo
- Working-tree status with stage/unstage (single file or all at once); filter
  the changes list by path and by category (included/excluded, new/modified/
  deleted)
- Branch menu: switch (prompts to bring or stash in-progress changes; branches
  show their last-commit time, sorted by recency with the default pinned on
  top), create (off the current or default branch), rename, delete
  (auto-switches off the current branch first), discard all changes, stash/pop,
  update from the default branch, merge, squash-merge (leaves changes staged
  for your own commit message — AI included), and rebase (auto-aborts on
  conflicts); right-click any branch for rename/copy/delete
- Error toasts include a Copy button for long git/provider messages
- Commit history browser: commit list with per-commit changed files and diffs
- Compare branches: pick a branch to see what the current one adds (the
  merge-base/three-dot diff a PR would show), the commits ahead and behind,
  and drill into any of them
- Publish a local repository to GitHub (via gh): for a repo with no remote,
  create the GitHub repo, wire up `origin`, and push in one step
- Pull requests (via the GitHub CLI): from the Compare tab, push the current
  branch and open a PR into the compared branch, with an AI-generated title
  and description from the branch diff and its commits
- Pull Requests tab: browse open GitHub PRs with a full in-app read view
  (description, commits, changed files + diffs, CI checks, review comments)
  and act on them — comment, review (approve / comment / request changes),
  merge (merge commit / squash / rebase, with optional branch deletion),
  close, and mark drafts ready
- Local PRs: propose a branch merge, review the diff/commits, leave notes,
  approve, and merge locally (merge commit / squash / rebase) without ever
  touching GitHub; local PRs are private to you, never written into the repo
- **AI PR review** (any PR, GitHub or local): a streamed general code review or
  a focused **security audit** of the PR's changes, using a provider/model you
  pick for review (separate from the commit-message model); optionally post the
  result as a comment
- Right-click context menus: files (discard to recycle bin, add to
  .gitignore by file/folder/extension, copy paths, show in Explorer, open in
  your configured editor or the default program) and commits (amend, mixed
  reset, checkout, revert, branch/tag from commit, cherry-pick onto the
  current branch, copy SHA). Shift/Ctrl-click selects a range of commits to
  cherry-pick onto another branch (rolled back entirely if any conflict)
- Repository menu (click the repo name): View on GitHub / Create issue (via
  gh), open a terminal at the repo root (Command Prompt, PowerShell, Git Bash,
  WSL, or a custom one — chosen in Settings), show in Explorer, open in your
  configured editor, copy the path, or remove it from the recent list
- Undo the latest unpushed commit (soft reset; message returns to the box)
- Diverged-branch handling: when local history was rewritten (e.g. after an
  amend), Push becomes a confirmed force push using --force-with-lease
- Unified/split diff viewer
- Commit with title + body; fetch/pull/push with ahead/behind indicators
- **AI commit messages**: streams a title/body into the commit box from the
  staged diff, recent commit style, and your instructions
- **AI ignore patterns**: keep noisy paths (lockfiles, vendored folders) out
  of the AI context while still committing them normally
- **Bring your own model**: Anthropic, OpenAI, OpenRouter, or local Ollama,
  with live model lists fetched from each provider in a searchable picker
- API keys live in the OS keychain (Windows Credential Manager, macOS
  Keychain, libsecret) — never in app files

## Custom instructions

Two layers, both included in every generation:

- **Global** — Settings → "Commit message instructions" (e.g. "Follow
  Conventional Commits").
- **Per-repo** — create `.gitdesktop/instructions.md` in a repository.
  Takes precedence over global instructions.

## AI ignore patterns

Exclude files from the AI's context (they stay staged/committed as usual).
gitignore-style globs, applied as git pathspec excludes:

- **Global** — Settings → "Excluded files" (one pattern per line).
- **Per-repo** — create `.gitdesktop/aiignore` in a repository.

## Development

Prereqs: Rust toolchain, Node 20+, pnpm, git on PATH. The pull-request
features additionally need the GitHub CLI (`gh`) installed and authenticated
(`gh auth login`); they stay hidden when it isn't available.

```sh
pnpm install
pnpm tauri dev    # run the app
pnpm build        # typecheck + bundle frontend
pnpm lint         # biome
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
```

### Architecture

- `src-tauri/src/git/` — typed Tauri commands that shell out to the system
  `git` CLI (porcelain v2 parsing, per-repo mutation locks, timeouts)
- `src-tauri/src/secrets.rs` — OS keychain storage for provider API keys
- `src/lib/git/` — invoke bindings + TanStack Query hooks (status polls 5s
  while focused and refetches on window focus/mutations)
- `src/lib/ai/` — Vercel AI SDK wrapper; all providers use the Tauri HTTP
  plugin's `fetch` so requests bypass webview CORS; allowed hosts are scoped
  in `src-tauri/capabilities/default.json`
- `src/features/` — welcome / repository / diff / commit / settings screens
