# GitDesktop

An AI-native Git client: GitHub Desktop-style basics with provider-agnostic,
customizable AI commit message generation.

## Features (Milestone 1)

- Open, clone, and switch between local repositories (recent list persisted)
- Working-tree status with stage/unstage (single file or all at once), branch
  switching/creation
- Commit history browser: commit list with per-commit changed files and diffs
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

Prereqs: Rust toolchain, Node 20+, pnpm, git on PATH.

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
