# Changelog

All notable, user-facing changes to GitDesktop are recorded here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are curated for humans. They're drafted from the commit history
(`pnpm changelog`) and then rewritten into clear, user-facing notes — not a raw
commit list.

## [Unreleased]

### Added

- **GitHub Pages config, in the app.** A new **Pages** tab in repository settings: enable
  Pages from a branch + folder or via **GitHub Actions**, see the live URL and build
  status, change the source, set a **custom domain**, **enforce HTTPS**, and disable the
  site. Part of the org/repo governance buildout.

- **Branch rulesets, in the app.** A new **Rules** tab in repository settings manages
  GitHub's modern branch rulesets: list them, flip **enforcement** (Active / Evaluate /
  Disabled) right from the list — including the **reversible "disabled" soft-off** that
  keeps the ruleset instead of deleting it — and create or edit one with a focused editor
  (target branches, require a PR with approvals / code-owner review / stale-dismissal,
  require status checks, block force pushes, restrict deletions, require linear history,
  require signed commits). Editing preserves any advanced rules the editor doesn't
  surface, and org-level rulesets show read-only. Part of the org/repo governance
  buildout ([docs](docs/github-governance-expansion.md)).

- **Repository danger zone, in the app.** The General tab of repository settings gained a
  **Danger zone**: **rename**, **archive / unarchive** (reversible), **change visibility**
  (public / private / internal), **transfer ownership**, and **delete** the repository.
  The three irreversible actions (visibility, transfer, delete) are each behind a
  type-the-`owner/repo`-name confirmation that spells out the consequences first. Deleting
  detects when your `gh` sign-in lacks the `delete_repo` scope and shows the exact
  `gh auth refresh` command to run. Your local clone is never touched. Part of the
  org/repo governance buildout ([docs](docs/github-governance-expansion.md)).

- **Code security & analysis toggles, in the app.** A new **Security** tab in repository
  settings collects secret scanning (and its **AI-detection** and **non-provider-pattern**
  sub-toggles), push protection, code scanning (CodeQL default setup), Dependabot alerts
  and security updates, and private vulnerability reporting behind a **save/discard bar**
  — flip what you want and save once (changes apply in the right dependency order). On
  private repos it notes which features need GitHub Advanced Security. **Dependabot
  version updates** — which GitHub only configures through `.github/dependabot.yml` — gets
  a **scaffold**: pick your package ecosystems and schedule and it writes the file to your
  working tree for you to commit (it won't overwrite an existing one). The remaining
  API-less options (dependency graph, grouped security updates, self-hosted runners)
  appear as **"Manage on GitHub"** links rather than dead toggles.

- **Manage repo collaborators & invitations, in the app.** A new **Access** tab in
  repository settings lists your collaborators with their role, lets you **invite**
  someone by username at any level (Read / Triage / Write / Maintain / Admin), **change**
  a collaborator's role inline, and **remove** them — plus a **pending invitations** list
  you can re-role or cancel. (Removing someone revokes only their direct access; team/org
  access is managed at the org level, coming later.) Part of the org/repo governance
  buildout ([docs/github-governance-expansion.md](docs/github-governance-expansion.md)).

- **Edit the Sponsor button, in the app.** A new **Sponsor** tab in repository settings
  edits `.github/FUNDING.yml` — the file that powers your repo's **Sponsor** button —
  with fields for GitHub Sponsors, Patreon, Open Collective, Ko-fi, Liberapay, Buy Me a
  Coffee, Polar, Tidelift, and custom URLs. Saving writes `.github/FUNDING.yml` to your
  working tree — review and commit it like any other change to publish; one click removes
  it. (GitHub has no API for the "Sponsorships" *feature* toggle, but it's on by default —
  the file is what matters, which is why this is the right lever.)

- **Manage GitHub secrets & variables, in the app.** A new **Secrets & variables** tab
  in repository settings lists and edits **Actions, Dependabot, and Codespaces secrets**
  and **Actions variables**, at **repository or environment** scope. Secret values are
  encrypted on your machine before they're sent (GitDesktop never handles the raw
  encryption), and — as on GitHub — can't be read back, only replaced or removed; a
  reused name updates the existing variable. Part of the broader org/repo governance
  buildout ([docs/github-governance-expansion.md](docs/github-governance-expansion.md)).

- **More GitHub repo settings, in the app.** The repository-settings dialog gained a
  **template repository** toggle, **default squash/merge commit message** pickers, and
  an **allow forking** toggle (shown only on org-owned private repos, the one place
  GitHub lets it change) — plus an **"Only on GitHub"** list that deep-links the five
  settings GitHub exposes to no app (sponsor button, commenting on commits,
  LFS-in-archives, per-push branch/tag limit, auto-close issues on merge), so they're
  discoverable instead of silently missing. This is the first slice of a broader
  org/repo governance plan ([docs/github-governance-expansion.md](docs/github-governance-expansion.md));
  the app can now also read your `gh` token's OAuth scopes, groundwork for features that
  prompt for the exact `gh auth refresh -s <scope>` they need.

- **More of your git config, editable in the app.** Settings → **Git** gained two
  controls that write straight to your global git config: **line endings**
  (`core.autocrlf`) — with a note on the right choice per OS — and, when a repository
  is open, a **per-repository identity override** (`git config --local user.name` /
  `user.email`) so you can commit as a different author in just that repo without
  touching your global identity. The override clears back to the global identity with
  one click, and both apply immediately. They join the global identity and
  default-branch fields already in that panel.

- **Integrated terminal.** Every agent session gained a built-in terminal — toggle it
  with the terminal hotkey (`Ctrl`/`⌘`+`J`) or the **Terminal** button — so you can
  run commands right inside GitDesktop instead of opening a separate window. It's a real
  shell (a PTY) in a resizable bottom dock that keeps running while hidden, so a dev
  server you start stays up. For a **container** session the terminal runs *inside* the
  session's Docker/Podman container — clicking **Terminal** opens a small popover to
  choose which dev-server port(s) to publish *before* it spins up (so a busy host port
  doesn't kill the launch), where you can also **reconnect** to or **stop** a container
  that's still running; for a host session it's a shell in the worktree.

- **Run a task several ways at once (best-of-N).** The Delegate composer gained a
  **Best-of-N** button: run the same task across 2–5 arms, **each with its own agent,
  model, and effort** — mix Claude, Codex, Copilot, and opencode so different providers
  attack the problem from different angles. Each arm runs in its own worktree; review
  them side by side and **keep the best one** with a single click (it discards the
  rest). Because fanning out multiple agents costs real money, a confirmation first
  shows an **upfront estimate** drawn from what your own recent sessions actually cost
  (scaling with the arm count), and the ensemble's **running total** is shown while it
  works. It's opt-in and never the default — best for open-ended tasks with several
  good approaches.

- **Plan a task before you build it.** A new read-only **Plan** mode in the Agent
  surface: describe a task (or start from an existing issue with the new **Plan**
  button on any issue) and a repo-aware agent explores your actual code, then drafts
  an agent-ready issue — problem, proposed approach, affected files, acceptance
  criteria, and a verify plan — **without changing anything**. Cited file paths are
  checked against your repo, so hallucinated references are flagged before you file.
  The planning run's cost is shown when reported. If the plan left any decisions
  open, they appear as an **answerable panel** (modeled on Claude Code's clarifying
  questions): pick from the suggested answers or write your own, and **Refine plan**
  *continues the same planning conversation* with your answers — the agent keeps its
  exploration in context and refines incrementally instead of starting over. A
  **follow-up composer** lets you keep chatting to revise the plan anytime, and the
  whole thing **persists across restarts** — close the app and your plans (and their
  conversation) are right where you left them, still resumable. (Plans are a read-only
  agent conversation: read tools only, no worktree, never a write.) Review it, then
  create a local or GitHub issue from it in one click. Plans live in the **Agent
  sidebar** alongside your sessions and **run several at once** — start one, switch to
  another, and come back; none are lost. Reach it from the Agent tab's "Plan a task"
  mode, the command palette, or an issue's Plan button.
- **Hand a plan or issue straight to an agent.** A finished plan gets an **Implement**
  button that **starts a write-capable session directly** (a quick popover sets the
  agent / model / effort first); any open local or GitHub issue gets **Solve with
  agent** (it's a problem to investigate → diagnose → fix), which seeds the Delegate
  composer to confirm. Either way the agent works in an isolated worktree, the way
  every agent session does. Once a plan is being implemented it becomes a **read-only
  reference** (its row tracks the session's live status), and it **archives to its own
  Archived tab** once that session is accepted. Closes the loop from planning to a
  working change.
- **Bring any OpenAI-compatible provider.** A new "OpenAI-compatible" provider lets
  you point GitDesktop at any OpenAI-compatible `/chat/completions` endpoint with your
  own API key. One-click presets cover the **Vercel AI Gateway** (one key, many
  models), **Google Gemini**, **DeepSeek**, **Mistral**, and **Z.ai** — or type any
  base URL. Live model lists and "Test connection" work just like the built-in
  providers. (A custom host outside the presets must be added to the app's network
  allowlist.)
- **Slash commands _and skills_ in the agent composer.** Type `/` to pick a reusable
  prompt or a skill. The menu pulls together built-in starters (`/review`, `/test`,
  `/fix`, `/explain`, `/refactor`, plus `/clear`); custom commands you define under
  **Settings → Slash commands**; and — tailored to the **selected agent** — its own
  commands and **Agent Skills**, discovered from both the project and your home
  directory, including the shared `.agents/skills` store (so your **global skills**
  show up too), plus a curated set of the CLI's own **built-in commands** (like
  `/init`). Type `/` to browse the whole list — it's scrollable, no narrowing
  needed. Commands support `$ARGUMENTS` (and `$1`, `$2`…) and are expanded in-app
  before reaching the agent; picking a **skill** nudges the agent to use it by name, so
  the CLI loads the real skill (scripts, references and all) instead of pasting it in.
  The menu is keyboard-driven, like `@file` mentions.
- **opencode joins the agent line-up.** You can now drive agent sessions and AI
  reviews with [opencode](https://opencode.ai) alongside Claude Code, Codex, and
  GitHub Copilot — pick it in the agent composer or as a review provider. opencode's
  **free hosted models need no API key**, so it's a genuinely keyless option out of
  the box (point it at your own provider for paid models too). Sessions run on the
  host, confined to their throwaway worktree, and resume cleanly across turns and
  app restarts like the other agents.
- **The window remembers where you left it.** GitDesktop now reopens at the size,
  position, and maximized state from your last session, validated against your
  current monitors so an unplugged display can't strand it off-screen. Settings →
  About also gained a live readout of the window's current position, size, and
  display, with a button to copy the coordinates.
- **Watch an agent session work, live.** The Changes tab now reflects the worktree's
  uncommitted edits *as the agent makes them*, before each turn's checkpoint commit
  — so you can follow along instead of waiting for the commit to land.
- **Test a session's changes before you keep them.** Every active session gained an
  **Open** menu — open its worktree in your editor, a terminal, or the file manager and
  run it for real before you Keep or Discard. The worktree is a full checkout on the
  session's branch, isolated from your working tree. For a **container** session, whose
  dependencies were installed for Linux, the live shell is the integrated **terminal**
  (above) — a shell *inside* the same image with the worktree mounted, so `pnpm install`
  and running it happen in the matching environment rather than failing against
  host-incompatible deps; that's where you choose the dev-server ports to publish and
  reconnect to or stop a still-running container. Keeping or discarding the session
  shuts its test container down for you.
- **Promote a kept session to a local PR.** A kept agent session gained a **Create
  PR** button (and command-palette action) that opens a local pull request from its
  branch, prefilled and ready — a one-click hand-off from "agent finished" to review.
- **See a session's pull-request and merge state on its row.** Agent session and plan
  rows now show a pull-request audit chip — **PR open**, **PR closed**, or **Merged** —
  derived from the session branch's local *and* GitHub pull request, so you can tell at
  a glance whether the agent's work actually landed. An implemented plan reads
  "Implemented · Merged" once its session's PR is merged. Merge status is read from the
  pull request itself (not `git merge-base`), so it stays correct through squash and
  rebase merges, including a local PR you've promoted to GitHub.
- **opencode runs in the container sandbox too.** opencode joins Claude and Codex as
  a container-isolated agent (kernel-enforced filesystem confinement) — add it under
  Settings → AI → agent image and rebuild. Its free hosted models need no key, so the
  container runs keyless.
- **Deeper opencode reviews.** Turn on "Read repo files for context" for an opencode
  review and it explores surrounding files (via opencode's read-only plan agent — it
  can read but never write), not just the diff.
- **GitHub Copilot runs in the container sandbox too.** Copilot joins Claude, Codex,
  and opencode as a container-isolated agent — add it under Settings → AI → agent
  image and rebuild. Copilot has no credentials file to mount (its login lives in the
  OS keychain), so its container authenticates from your GitHub CLI token (`gh auth
  token`), passed securely by environment — never written to disk or visible in the
  container's arguments.
- **Deeper Copilot reviews.** "Read repo files for context" now works with Copilot
  too: it reads surrounding files for context while a hard deny on the write and shell
  tools keeps it strictly read-only, even when reviewing in your live repo.
- **Global skills reach container sessions.** A container-isolated agent session now
  mounts your global skills (`~/.agents/skills`) read-only, so a skill invoked by name
  resolves inside the container just as it does for a host session — previously only
  skills committed to the repo were visible there.

### Fixed

- **The "default branch for new repositories" setting now updates git itself.**
  Settings → Git's default-branch field used to be a GitDesktop-only preference: it
  changed what the app's *Create repository* dialog did, but never touched your global
  git config — so `git config --global init.defaultBranch` (and a command-line
  `git init`) still used the old branch. The setting now reads from and writes to your
  global git config (`init.defaultBranch`), with its own **Save**, the same as the Git
  identity field beside it — so GitDesktop and the command line finally agree.
- **Container agent sessions now actually run the agent.** A container-isolated
  session was launching `node` instead of the agent CLI inside the container (the CLI
  name wasn't passed as the command), so Claude/Codex/opencode sessions failed to
  start in container mode. They now run correctly. (Host sessions were unaffected.)
- **AI reviews now show why they failed.** A failed PR/local review used to revert
  silently to the empty "Run a review…" placeholder with no explanation; it now
  displays the actual error (and keeps any partial output that streamed first).
  CLI-agent failures also no longer surface as a useless `[object Object]`.
- **The co-author picker is fully keyboard-navigable.** When adding a commit
  co-author, ↑/↓ now move through the suggestions and Enter adds the highlighted
  one (it's a proper combobox), instead of only being able to add the top match or
  reach for the mouse.
- **A couple of dead-ends now explain themselves.** The repository Insights error
  no longer prints a raw error string, and the Actions toolbar's "Run workflow" and
  refresh buttons, when disabled, now say they need a GitHub CLI sign-in instead of
  greying out silently.

### Changed

- **Calmer repository settings.** The repository settings dialog moved from a wrapping
  row of eight tabs to a vertical sidebar — grouped into Repository, Security,
  Publishing, and Automation — matching the app's main Settings. The **Danger zone** is
  now its own sidebar item instead of riding the bottom of the General tab, so delete /
  transfer / visibility live behind a deliberate click rather than below your topics.
  Arrow keys move between sections, and the panel crossfades as you switch (respecting
  "reduce motion").
- **Configure and rebuild the agent container image.** Settings → AI now lets you
  pick the image's **Node version** (default 24 LTS, or 22 / 20) and **which agents**
  to install (Claude / Codex), and adds **Rebuild** — which pulls a fresh base image
  and reinstalls the CLIs so newer releases are picked up. Previously the image was
  built once with a fixed Node version and every agent baked in, with no way to
  update it. A stale image (built for a different Node/agent selection) is flagged
  for rebuild, and starting an agent the image wasn't built with now fails with a
  clear message instead of a cryptic in-container error.
- **Subtle, calm transitions in a few spots.** A handful of state changes now ease
  in instead of popping: the Send/Stop, Generate/Cancel, and Review/Cancel buttons
  when an AI task starts or stops; agent sessions sliding in and out of the list as
  you start, keep, or delete them; the "jump to latest" button in an agent chat;
  the ahead/behind badges in the toolbar; and a soft fade as the Changes list
  replaces its loading placeholder. Everything respects your system "reduce motion"
  setting (it falls back to a plain fade or no animation).
- **The mint brand color now lives in the app, as a restrained accent.** Primary
  actions (Open repository, Commit, Send a task…), the current selection in lists,
  and keyboard focus rings are now GitDesktop's mint instead of flat gray — so the
  one primary action and where the keyboard is focused are obvious at a glance on
  every screen. The calm monochrome base is unchanged; mint only marks action,
  selection, and focus. Under the hood, the status colors (added / modified /
  deleted, success / warning / error, merged) are now driven by shared design
  tokens, so they stay consistent across every view instead of drifting per-screen,
  and the diff line-selection highlight uses the accent instead of a one-off blue.

### Fixed

- **Rust diffs no longer lose syntax highlighting partway down a file.** A large
  Rust diff could render the top of a file highlighted and everything past a
  certain line as plain text — a quirk of the lightweight highlighter mis-reading
  a character literal or lifetime and giving up on the rest of the file. Rust now
  renders with the same VS Code-grade grammar already used for TypeScript, Vue,
  and others, which highlights every line reliably.

### Added

- **GitHub Copilot CLI joins Claude Code and Codex as an agent.** Pick **GitHub
  Copilot** in the agent-session composer to delegate a task to it — keyless, via
  your Copilot subscription. It runs worktree-confined on the host (its file edits
  are limited to the worktree), and multi-turn follow-ups resume the same session.
  Copilot is also available as a code-review provider, and it appears in Settings →
  About alongside the other CLIs. (Container isolation and repo-aware review for
  Copilot are coming next; an `opencode` slot is recognized for a future release.)
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
  far) right in the session. Pick the **provider** (Claude, Codex, or Copilot),
  the **model**, and a **reasoning-effort level** for the session — model and
  effort are changeable as you go (effort maps to each CLI's own mechanism, so it
  applies where the provider supports it). **Run
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
