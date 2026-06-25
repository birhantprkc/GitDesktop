# Conductor — Feature Matrix

Competitive audit: **Conductor** (conductor.build) vs **GitDesktop**, focused on the
**agentic-workflow** axis (audited 2026-06-24). Conductor facts were researched against
conductor.build / its docs / changelog / blog and adversarially verified; GitDesktop is
grounded against its own repo (`CHANGELOG.md`, `docs/`). Conductor ships fast (70+ releases)
and its pricing/model surface churns — treat version- and price-specific notes as "as of the
audit date."

```txt
✅  = supported (shipped / GA)
🔜  = built on GitDesktop `master` but NOT in the v0.1.0 release — GitDesktop is pre-1.0;
      the agent-sessions / plan-mode layer lands in an upcoming release (GitDesktop column only)
🟡  = partial / limited / unverified from primary sources
❌  = not supported
⭐  = clear differentiator for whichever tool owns it
N/A = outside that product's category (see Notes)
```

---

## What each product is

**Conductor** (conductor.build) is a **focused agent-orchestration desktop app for macOS**
(Apple Silicon; Intel "in progress," **no Windows/Linux**). Built by **Melty Labs** (Charlie
Holtz & Jackson de Campos; YC S24, Series A from Spark + Matrix in 2026), it runs **multiple
coding agents in parallel**, each isolated in its own **git worktree** with a branch, a
terminal, and a guided **task → agents → review → merge** flow. It is **multi-provider**: it
drives Claude Code and Codex, added **Cursor**, and an **OpenCode** harness that runs *any* LLM
(OpenRouter/Bedrock/Vertex/Cerebras/Vercel AI Gateway/custom). Tight **GitHub + Linear**
integration and **one-click MCP** setup. The desktop app is **free to use** (bring your own
agent subscription/keys); an optional **Conductor Cloud** runs agents in Vercel Sandbox
micro-VMs at usage pricing; enterprise plans exist (undisclosed). **Closed-source.** It is
**not a git client** — you still manage branches/history/commits via the CLI or github.com.

**GitDesktop** is an **AI-native, keyboard-first, cross-platform local git + GitHub client**
(Windows/macOS/Linux; Tauri 2 + React 19; open source, Apache 2.0). It ships the full PR
lifecycle (incl. **local PRs** that need no remote), a **GitHub Actions cockpit**, git
history/blame/branching, and AI woven through commits, **code review + security audit**, and CI
debugging. Its **agent-sessions layer** — worktree-isolated parallel write sessions, multi-turn,
plan mode, multi-provider, container isolation — is the **direct analog to Conductor**, but it's
**built on `master` and not yet in the v0.1.0 release** (2026-06-19), so it reads **🔜** below.
GitHub runs through the `gh` CLI (no token custody); AI keys live in the OS keychain.

> **Category framing:** Conductor and GitDesktop's *agent layer* go head-to-head. But Conductor
> is **only** an agent orchestrator, while GitDesktop wraps the same parallel-agent idea inside a
> **complete git/GitHub client** (§9). The other asymmetry: Conductor is **shipped and polished
> today**; GitDesktop's agent layer is **built but unreleased**. Both matter to an honest read.

---

## 1. Parallel agent sessions & workspaces

| Feature | Conductor | GitDesktop |
| ------- | --------: | ---------: |
| Concurrent agents, each its own session | ✅⭐ | 🔜 |
| **Isolated git worktree per agent** (own branch) | ✅⭐ | 🔜 |
| Per-workspace terminal | ✅ | 🔜 |
| Multi-turn conversation, persisted | ✅ | 🔜 |
| Keep / discard / resume lifecycle | ✅ | 🔜 |
| Watch changes live as the agent edits | 🟡 | 🔜 |
| Notify on turn completion | 🟡 | 🔜 |
| Pin / archive runs | ✅ | 🔜 |
| Search / filter runs by task or branch | ✅ | 🔜 |
| Run commands / a dev server per workspace | ✅⭐ | 🔜 |

**Notes:**

- The **worktree-per-agent** model is core to both — and it's the single biggest overlap. Conductor auto-creates a worktree + branch per workspace; GitDesktop's sessions do the same (`git/worktree.rs`), with **Active / Kept / Archived** tabs, search, and JSONL persistence across restarts.
- The decisive difference is **maturity, not design**: Conductor's is shipped and refined; GitDesktop's is on `master`, dogfooded, **unreleased**.
- **Run-a-dev-server-in-the-workspace** is a Conductor strength worth calling out (terminal + setup/run scripts per workspace). GitDesktop's analog is the (unreleased) container **Test** shell with a configurable published port — close, but not the same always-on per-workspace terminal.
- Conductor's "live changes" are checkpoint-based; GitDesktop's (unreleased) Changes view reflects the worktree's *uncommitted* edits as the agent makes them.

---

## 2. Driving an agent

| Feature | Conductor | GitDesktop |
| ------- | --------: | ---------: |
| Task input via prompt | ✅ | 🔜 |
| Live watch of agent progress | ✅ | 🔜 |
| Multi-turn follow-up | ✅ | 🔜 |
| Prompt history (↑/↓ recall) | 🟡 | 🔜 |
| `@file` mentions | ✅ | 🔜 |
| Attach terminal output to a message | ✅⭐ | ❌ |
| Interactive terminal in the workspace | ✅⭐ | 🔜 |
| Run commands async / dev server | ✅⭐ | 🔜 |
| Per-workspace env vars + setup scripts | ✅⭐ | 🔜 |
| Interrupt / cancel mid-run | 🟡 | 🔜 |

**Notes:**

- Conductor leans into the **workspace-as-dev-environment** idea: an interactive terminal, `@terminal` to feed command output back into the chat, setup scripts to install deps before an agent runs, and a `.context` folder for handoff notes. This is more developed than GitDesktop's composer-centric flow.
- GitDesktop's (unreleased) composer has `@file` mentions, clickable agent-mentioned paths, ↑/↓ prompt recall, Edit-&-resend on a failed turn, and a Conversation⇄Changes toggle — but **no per-workspace interactive terminal** today (the container Test shell is the nearest thing).
- "Attach terminal output to a prompt" is a genuinely nice Conductor affordance GitDesktop has no answer for.

---

## 3. Models & providers

| Feature | Conductor | GitDesktop |
| ------- | --------: | ---------: |
| Pick which agent CLI drives a run | ✅ | 🔜 |
| Model picker (same-provider) | ✅ | 🔜 |
| Reasoning-effort control | ✅ | 🔜 |
| Claude Code | ✅ | 🔜 |
| Codex | ✅ | 🔜 |
| Cursor agent | ✅⭐ | ❌ |
| opencode / OpenCode harness (any LLM) | ✅ | 🔜 |
| GitHub Copilot CLI | 🟡 | 🔜 |
| Keyless agents (reuse a subscription) | ✅ | ✅ / 🔜 |
| OpenAI-compatible custom base URL | ✅ (via OpenCode) | 🔜 |
| Local models (Ollama / LM Studio) | 🟡 | 🔜 |
| **MCP** server support | ✅⭐ | ❌ (backlogged) |

**Notes:**

- **Both are multi-provider** — correcting a common assumption that Conductor is Claude-only. Conductor: Claude Code + Codex + **Cursor** + an **OpenCode** harness reaching any LLM (OpenRouter/Bedrock/Vertex/Cerebras/Vercel AI Gateway/custom). GitDesktop (🔜): Claude Code / Codex / **GitHub Copilot CLI** / **opencode** (free hosted, genuinely keyless), plus an OpenAI-compatible provider on the HTTP side.
- **Cursor** is Conductor-only; **GitHub Copilot CLI** as a first-class session agent is GitDesktop-only. Each excludes the other's signature agent.
- **MCP is Conductor's edge here** and a direct GitDesktop gap: Conductor offers one-click MCP server setup; GitDesktop suppresses MCP in its agent runs today. GitDesktop has a written plan to close it — [docs/mcp-agent-sessions-tier1.md](docs/mcp-agent-sessions-tier1.md) — but it's backlog, not shipped.
- GitDesktop's shipped AI (generation + review) already runs **local Ollama** and **keyless Claude/Codex** today; Conductor's local-model story rides through OpenCode and is less turnkey (🟡).

---

## 4. Review & merge loop

| Feature | Conductor | GitDesktop |
| ------- | --------: | ---------: |
| Diff viewer (unified) | ✅ | ✅ |
| Side-by-side / split diff | 🟡 | ✅ |
| Image diffs | 🟡 | ✅ |
| Syntax highlighting | ✅ | ✅ |
| Per-file navigation + inline comments | ✅ | ✅ |
| Pre-merge "Checks" dashboard (status + CI + comments) | ✅⭐ | 🟡 |
| Create a GitHub PR from the work | ✅ | 🔜 |
| **Local PR** (no remote) | ❌ | ✅⭐ |
| Merge into base | ✅ | ✅ |
| Conflict detection & resolution | 🟡 | ✅ |
| Squash / reorder commits | 🟡 | ✅ |
| **AI code review + security audit** | ❌ | ✅⭐ |

**Notes:**

- Conductor's **Checks tab** — git status + PR metadata + CI + GitHub comments + deployments + todos in one pre-merge pane — is a real differentiator; GitDesktop surfaces the same data but spread across PR/Actions views rather than one cohesive board.
- The git-mechanics rows (split/image diff, conflict resolution, squash/reorder) are **shipped, app-wide ✅ in GitDesktop** because it's a full git client — they're not gated behind the agent layer. Conductor leaves heavier git surgery to the CLI (🟡).
- **Local PRs** (full describe/comment/approve/merge against any two branches, no remote) and **AI code review + security audit** are GitDesktop ⭐s with no Conductor equivalent — Conductor has no built-in review mode. (GitDesktop's *iterative* review that folds in other bots' comments is 🔜; the basic review + security audit shipped in v0.1.0.)
- GitDesktop's (🔜) "Create PR" on a kept session opens a **local** PR, promotable to GitHub in one click; Conductor creates the GitHub PR directly.

---

## 5. Plan / spec & orchestration

| Feature | Conductor | GitDesktop |
| ------- | --------: | ---------: |
| Read-only plan / propose-before-writing | 🟡 | 🔜 |
| Human approval gate | 🟡 | 🔜 |
| File-path validation vs the repo | ❌ | 🔜 |
| Answerable-questions panel + refine | ❌ | 🔜 |
| Plan → issue (local / GitHub) handoff | ❌ | 🔜 |
| Plan/issue → "Implement" write session | 🟡 (issue→workspace) | 🔜 |
| Best-of-N (same task, N agents, compare) | ❌ | 🔜 |
| Upfront / live cost estimate | ❌ | 🔜 |
| Multi-agent pipelines (roles, gates) | ❌ | ❌ (designed, deferred) |
| Multi-repo in one workspace | 🟡 (`/add-dir`) | ❌ |

**Notes:**

- Conductor's **plan mode could not be confirmed** from primary docs (the dedicated page 404'd; it's referenced in changelog but may be renamed or an OpenCode-ecosystem concept) — hence 🟡. Treat any plan-mode comparison as provisional.
- **GitDesktop's plan layer is its sharpest agentic differentiator** (all 🔜): a read-only repo-aware planner that drafts an agent-ready issue (problem/approach/affected files/acceptance criteria), **validates cited paths** against the repo and flags hallucinated ones, surfaces open decisions as an **answerable-questions panel**, refines in-place, then hands off to a write session via **Implement / Solve-with-agent**. Conductor's issue→workspace is shallower (seed a run from a GitHub/Linear issue) but real and shipped.
- **Best-of-N** (run a task 2–4 ways in parallel, compare, keep one) with cost display is GitDesktop-only (🔜). **Higher-order pipelines/roles/gates** are deferred in *both* (GitDesktop has a written design in `docs/agent-orchestration.md`; Conductor's direction is unclear).
- Conductor's `/add-dir` lets **one** agent edit across repos; that's multi-*directory*, not parallel multi-repo orchestration.

---

## 6. Isolation & environment

| Feature | Conductor | GitDesktop |
| ------- | --------: | ---------: |
| Local execution on your machine | ✅ | 🔜 |
| Worktree isolation (default) | ✅ | 🔜 |
| OS-sandbox confinement (Seatbelt/Landlock) | 🟡 | 🔜 |
| Docker/Podman container sandbox | 🟡 | 🔜 |
| Setup / run scripts, env vars | ✅⭐ | 🔜 |
| Optional **cloud** execution | ✅⭐ | ❌ |
| Network egress lockdown / secret injection | 🟡 (cloud) | ❌ |
| Interactive shell in the sandbox image | ❌ | 🔜 |

**Notes:**

- **Conductor Cloud** is a real differentiator GitDesktop has no answer for: run agents in **Vercel Sandbox** micro-VMs (Firecracker), with secrets injected at the network layer and egress that locks down before untrusted code runs. GitDesktop is **local-only** by design.
- GitDesktop's (🔜) isolation ladder is arguably deeper *locally*: worktree by default, the CLI's own OS sandbox (Codex `-s workspace-write`, Claude permission modes), an **opt-in Docker/Podman container** (configurable Node 20/22/24, run-as-`node`, creds mounted read-only, global skills mounted), and a container **Test shell** with port mapping for matching-environment dev runs.
- Net: **Conductor wins on the cloud option; GitDesktop wins on local container depth** — and both are isolation-first.

---

## 7. Integrations & platform

| Feature | Conductor | GitDesktop |
| ------- | --------: | ---------: |
| GitHub PRs | ✅ | ✅ |
| GitHub issue → workspace/session | ✅ | 🔜 (Solve with agent) |
| **Linear** issue → workspace | ✅⭐ | ❌ |
| Graphite stacks | 🟡 | ❌ |
| GitHub **Actions cockpit** | N/A | ✅⭐ |
| Open in external editor | 🟡 | ✅ |
| One-click **MCP** servers | ✅⭐ | ❌ (backlogged) |
| OS notifications | 🟡 | ✅ |
| **macOS** | ✅ | ✅ |
| **Windows** | ❌ | ✅⭐ |
| **Linux** | ❌ | ✅⭐ |
| Team / multi-user | ❌ | ❌ |

**Notes:**

- **Platform is the starkest split: Conductor is macOS-only (Apple Silicon); GitDesktop is Windows/macOS/Linux.** For a Windows or Linux developer, Conductor simply isn't an option today.
- Conductor's **Linear** integration (and Graphite mentions) are real and GitDesktop has no answer; conversely GitDesktop's **Actions cockpit** (runs/jobs/logs/re-run/cancel/dispatch + Debug-with-AI) is entirely outside Conductor's scope (it only *watches* checks read-only).
- **MCP** again: a shipped Conductor integration vs a GitDesktop backlog item.
- **Neither has team/multi-user** today (Conductor has an experimental, non-production "agent teams" idea).

---

## 8. The rest of GitDesktop — a full git/GitHub client (out of Conductor's scope)

| Feature | Conductor | GitDesktop |
| ------- | --------: | ---------: |
| Repo management (clone / create / publish / fork) | N/A | ✅ |
| Branching (switch/create/rename/delete/archive/compare/rules) | 🟡 | ✅ |
| Changes & commits (hunk + line staging, amend, revert, reset) | 🟡 | ✅ |
| History + blame + search-all-history | N/A | ✅ |
| Cherry-pick / squash / reorder / stash browser | N/A | ✅ |
| Submodules | N/A | ✅ |
| **Local PRs** + promote-to-GitHub | N/A | ✅⭐ |
| Issues & local to-dos · Discussions | N/A | ✅ |
| Tags & releases · Insights · Git hooks | N/A | ✅ |
| Keyboard-first (rebindable, palette, cheat sheet) | N/A | ✅⭐ |

**Notes:**

- This is the category gap: **Conductor is not a git client.** Everything here is either delegated to the CLI/github.com or simply absent. GitDesktop is a complete git + GitHub client *and* hosts the parallel-agent layer — you don't need GitHub Desktop + a terminal + Conductor; it's one app.
- **Keyboard-first** is a GitDesktop identity (command palette, arrow-key nav, rebindable shortcuts everywhere); Conductor is mouse-driven.

---

## Where each tool wins

**Conductor's edge**
- **Shipped, polished, and opinionated** — a refined macOS app with a guided task→agents→review→merge flow and the **Checks** pre-merge dashboard. GitDesktop's equivalent is unreleased.
- **Workspace-as-dev-environment** — per-workspace terminal, setup/run scripts, `@terminal`, run a dev server next to the agent.
- **Cloud option** — Conductor Cloud (Vercel Sandbox micro-VMs) runs agents off your machine with egress lockdown.
- **MCP out of the box** and **Linear** + **Cursor** integration GitDesktop lacks.

**GitDesktop's edge**
- **Cross-platform** (Windows/macOS/Linux) vs Conductor's macOS-only — often the deciding factor.
- **A full git/GitHub client around the agents** — local PRs, Actions cockpit, history/blame, branching, keyboard-first — not just an orchestrator.
- **Multi-provider incl. keyless + local** (Claude/Codex/Copilot/opencode; Ollama) with **no credential custody** (GitHub via `gh`, keys in keychain).
- **Repo-grounded plan mode** (path validation, answerable questions, plan→issue→Implement) and **best-of-N** — more structured than Conductor's issue→workspace.
- **AI code review + security audit** built in; **open source** (Apache 2.0), zero platform cost.

---

## GitDesktop-only (vs Conductor)

| Feature | Status |
| ------- | ------ |
| Cross-platform (Windows + Linux + macOS) | ✅ shipped |
| Full git client (history/blame/cherry-pick/squash/reorder/stash/submodules) | ✅ shipped |
| **Local PRs** + promote-to-GitHub | ✅ shipped |
| GitHub **Actions cockpit** + Debug-CI-with-AI | ✅ shipped |
| **AI code review + security audit** (incl. keyless CLI-agent review) | ✅ shipped |
| Keyboard-first (palette, cheat sheet, rebindable) | ✅ shipped |
| Open source (Apache 2.0) | ✅ shipped |
| Repo-grounded **plan mode** (path validation, answerable Qs, → issue → Implement) | 🔜 unreleased |
| **Best-of-N** ensemble + cost estimate | 🔜 unreleased |
| Container sandbox **Test shell** with port mapping | 🔜 unreleased |

---

## Gaps / threats to watch

**What GitDesktop should consider adopting (from Conductor)**
1. **Ship the agent layer.** The biggest gap is timing: Conductor is mature and GitDesktop's parallel-agent layer is `[Unreleased]`. The fastest competitive move is releasing it.
2. **Workspace-as-environment.** A per-workspace interactive terminal + **setup/run scripts** (install deps, start a dev server beside the agent) — Conductor's most-loved ergonomics, partly answered only by GitDesktop's container Test shell.
3. **MCP.** Conductor's one-click MCP is shipped; GitDesktop's is a backlog ([docs/mcp-agent-sessions-tier1.md](docs/mcp-agent-sessions-tier1.md)). Shipping Tier 1 closes a visible gap.
4. **A cohesive pre-merge dashboard.** Consider a Conductor-style **Checks** view (git status + CI + comments + todos) as the default agent-session review surface.
5. **Linear (and stacked-PR) integrations** for teams that live in those tools.
6. **An optional cloud/async tier** (delegate long runs off the laptop) — Conductor Cloud's pitch; pairs with GitDesktop's deferred LAN/phone-companion idea.

**Where Conductor is exposed**
- **macOS-only** (no Windows/Linux), **not a git client**, **no AI review**, **closed-source**, and **single-user**. GitDesktop's full-client + cross-platform + open-source posture is the structural counter — *once its agent layer ships.*

---

## Sources

- **Conductor** — <https://www.conductor.build>, <https://www.conductor.build/docs>, the changelog
  and blog (Melty Labs; multi-agent harnesses incl. Cursor + OpenCode; macOS-only; one-click MCP;
  GitHub + Linear; Conductor Cloud on Vercel Sandbox; free desktop app + usage-priced cloud;
  closed-source). Plan-mode and split/image-diff specifics were **not confirmable** from primary
  docs at audit time and are marked 🟡.
- **GitDesktop** — `CHANGELOG.md` (`[0.1.0]` 2026-06-19 shipped vs `[Unreleased]` on `master`),
  `README.md`, `PRODUCT.md`, and `docs/` (`agent-sessions.md`, `plan-mode-issue-handoff.md`,
  `multi-agent-sessions.md`, `agent-orchestration.md`, `mcp-agent-sessions-tier1.md`). The
  agent-sessions / plan-mode / container / multi-agent layer is built but **unreleased** (🔜); AI
  review + security audit and the full git/GitHub client are shipped (✅).
