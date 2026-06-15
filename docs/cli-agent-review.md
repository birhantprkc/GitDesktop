# CLI-agent code review (Claude Code / Codex)

Design doc — **status: agreed approach, not yet implemented.** Captures the
verified facts so we can wire it up without re-researching.

## Goal

Let a user point GitDesktop's AI code review / security audit at a coding-agent
CLI they already have installed (`claude`, `codex`) instead of pasting an API
key. The headline win: these CLIs authenticate against the user's existing
**subscription** (Claude Pro/Max, ChatGPT Plus/Pro), so a review runs
**keyless**. Secondary win: in agentic mode the CLI can read surrounding code,
not just the diff we hand it.

This is a *parallel path*, not another `createModel()` case — a CLI agent is not
an OpenAI-style chat endpoint, so it routes around
[`createAiClient`](../src/lib/ai/client.ts).

## Architecture

- **Rust runner** — `run_agent_cli`, modeled on
  [`run_gh_raw`](../src-tauri/src/github/runner.rs): `tokio::process::Command`,
  `CREATE_NO_WINDOW`, `kill_on_drop(true)`, timeout, piped stdio. Reuse the
  stdin-piping shape from
  [`run_git_raw_input`](../src-tauri/src/git/runner.rs) — **the prompt/diff goes
  in on stdin**, never as an argv element (Windows `CreateProcess` caps the
  command line ~32 KB; real diffs exceed it).
- **Binary resolution** — do **not** rely on `Command::new("claude")`. A GUI app
  does not inherit the user's shell PATH. (Verified live on the dev machine:
  neither `claude` nor `codex` resolved in a tool-spawned Bash *or* PowerShell,
  even though Claude Code was installed.) Resolution order: explicit
  user-configured path → `PATH` → npm global prefix → `~/.local/bin`,
  `~/.claude/bin`, `~/.codex/bin` → Windows `.cmd`/`.exe`/target-suffixed names.
- **Detection command** — `detect_agent_cli`: resolve binary, get `--version`,
  probe auth (below).
- **Frontend** — new provider kind in [`types.ts`](../src/lib/ai/types.ts);
  [`useGenerateReview`](../src/features/pulls/useGenerateReview.ts) calls the
  Tauri command and parses the NDJSON stream into the same `text` it streams
  today. Never build the invocation as a shell string — pass an explicit argv
  array (an empty-string arg like `--tools ""` gets dropped by PowerShell word
  splitting; argv survives it, though commander may still reject it — see
  fallback below).
- **Settings** — for CLI providers, replace the API-key field in
  [`AiProviderSection`](../src/features/settings/AiProviderSection.tsx) with
  detection status ("✓ found + logged in" / "run `claude login`") and an
  optional explicit binary-path override.

## Read-only guarantee (non-negotiable)

A "review" must never edit, commit, or hit the network. Two tiers:

- **Tier 1 — diff-only (default, hardest guarantee).** Disable all tools and
  feed the diff we already build in
  [`buildReviewPrompt`](../src/lib/ai/prompt.ts). No tools = physically cannot
  edit and cannot hang on a permission prompt. Drop-in swap for the current
  AI-SDK path.
- **Tier 2 — agentic (the differentiator, later).** Allow read-only tools in the
  repo so the agent can read surrounding code. Requires the per-CLI read-only
  flag set below and careful verification.

## Claude Code (`claude`) — verified against v2.1.178

### Invocation (Tier 1)

```
claude -p
  --tools ""                       # disable all tools (read-only by construction)
  --system-prompt "<review system prompt>"   # replaces the huge default prompt
  --output-format stream-json
  --include-partial-messages
  --verbose                        # REQUIRED with stream-json in print mode
  --model <alias-or-id>
  --strict-mcp-config              # ignore the user's MCP servers
  # diff/prompt piped on stdin
```

- `--system-prompt` *replaces* the default system prompt — use
  `buildReviewPrompt().system`. Big token savings + full control.
- Fallback if commander rejects `--tools ""`: `--permission-mode plan` (or
  `dontAsk`) plus `--disallowedTools "Edit Write ..."`. Permission-mode choices:
  `acceptEdits | auto | bypassPermissions | default | dontAsk | plan`.
- Avoid `--bare`: it strips context (cheap/deterministic) **but forces
  `ANTHROPIC_API_KEY` and disables OAuth**, defeating the keyless goal.

### Output parsing (verified envelope)

NDJSON, one object per line:

| line `type` | meaning |
| --- | --- |
| `system` / `subtype:"init"` | session metadata: `model`, `permissionMode`, `apiKeySource`, `tools`, `slash_commands` |
| `system` / `subtype:"status"` | progress (`requesting`, …) |
| `stream_event` | wraps raw Anthropic SSE; live text = `event.type:"content_block_delta"` → `delta.type:"text_delta"` → `delta.text` |
| `assistant` | consolidated assistant message snapshot |
| `rate_limit_event` | `rate_limit_info.status` (`allowed`/…), `rateLimitType`, `resetsAt` |
| `result` | **terminal.** `is_error`, full `result` text, `total_cost_usd`, `permission_denials[]`, `terminal_reason` |

- **Stream** the `content_block_delta` text deltas; **finish** on the `result`
  event. Use `result.is_error` for success/failure and `permission_denials[]` to
  detect a blocked read-only violation.

### Auth (the keyless win, verified)

- `apiKeySource:"none"` in the init event while the call succeeded → ran on
  **subscription OAuth, no API key**.
- Pre-flight detection: `claude auth status` (subcommands: `login`, `logout`,
  `status`). Gate reviews on it. Long-lived token alternative for headless:
  `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`.

### Cost caveat (informs the Tier-1 trimming)

A trivial `"say OK"` run in the home dir cost **$0.16 / ~15 k cache tokens**
because it loaded the full interactive context (all tools, skills, 3 MCP
servers, memory, CLAUDE.md). Trim aggressively: `--tools ""`, `--system-prompt`,
`--strict-mcp-config`, and `--setting-sources` to avoid the target repo's
hooks/skills.

### Heavyweight option

`claude ultrareview [target]` is a real subcommand — cloud-hosted multi-agent
review that prints findings. Billed/slower; a possible premium "deep review"
button, not the default.

## Codex (`codex`) — from official docs; re-verify against pinned version

### Invocation (read-only, globals MUST precede `exec`)

```
codex --ask-for-approval never --sandbox read-only --cd <REPO_DIR>
  exec --json --skip-git-repo-check
  # prompt via arg or stdin "-"
```

- `-a never` + `-s read-only` is the real guarantee (no approval path ⇒ writes
  denied, not prompted). Native-Windows sandbox enforcement is newer/softer than
  macOS/Linux — treat as defense-in-depth; WSL2 is the stronger isolation story.
- Avoid `--full-auto` (maps to `workspace-write`, permits edits).
- No native review subcommand — use a review prompt in `exec`. `--output-schema`
  can constrain final output to structured findings (OpenAI cookbook pattern).

### Output

`--json` = JSONL events: `thread.started` → `item.started`/`item.completed`
(final text = last `item.completed` with `item.type:"agent_message"` →
`item.text`) → **`turn.completed`** (success, has `usage`) / `turn.failed` /
`error`. Plain `exec` (no `--json`) prints only the final message to stdout
(progress → stderr).

### Auth & detection

- Works on a **ChatGPT plan** (no API key). `codex login`; detect with
  `codex login status` (exit 0 = authed).
- When both a ChatGPT login and `OPENAI_API_KEY` exist, Codex prefers the login
  (helps our goal; the user's ambient key may be ignored).

### Known gotchas to guard

- **#19945**: `codex exec` can emit **empty stdout when stdio is detached from a
  TTY** — exactly our spawn shape. Treat "no `turn.completed`" as failure; rely
  on timeout + kill-on-drop.
- `--json`/`--output-schema` can be silently ignored when MCP servers are active
  (#15451) — disable MCP for the review run.
- Hang when out of quota (#6512) — timeout is the safety net; surface a clear
  rate-limit message.
- winget installs may expose `codex-x86_64-pc-windows-msvc.exe` not `codex.exe`
  (#11283) — probe both.

## Open decisions

1. **Which CLIs first** — recommend Claude Code first (verified end-to-end here),
   Codex second.
2. **Review invocation** — recommend **own-prompt + diff** for both (consistent,
   version-proof). Native `/security-review` (Claude) / `--output-schema`
   (Codex) deferred to Tier 2.
3. **Tier 1 vs Tier 2** — ship Tier 1 (diff-only) first; it's a clean swap for
   the existing review path and proves runner + detection + streaming.

## Suggested first slice

Claude Code, Tier 1, security audit button: `run_agent_cli` runner + binary
resolution + `detect_agent_cli` (version + `claude auth status`) + stream-json
parser feeding the existing review panel. Proves the whole path keyless.

## Verified vs. to-verify

- **Verified on this machine (claude v2.1.178):** headless flags, stream-json
  envelope, `result` terminal event, `apiKeySource:"none"` keyless run,
  `claude auth status` / `setup-token`, `ultrareview` subcommand, the `--tools
  ""` PowerShell quirk, the cost/context overhead.
- **To verify at implementation time:** `claude auth status` exact exit codes;
  whether commander accepts argv `["--tools",""]`; Codex everything (docs-based)
  against the user's pinned `codex` version — especially #19945 empty-stdout and
  `codex login status` exit codes.
