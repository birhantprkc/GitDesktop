/**
 * A section of the in-app user guide, rendered as Markdown in the Help screen.
 *
 * Keyboard shortcuts in `body` are written as tokens, NOT literal keys, so the
 * guide always shows the right key for the platform (⌘ on macOS) and reflects
 * the user's rebindings:
 *   - \`{{kbd:action-id}}\` — a rebindable action from the hotkey registry; resolves
 *     to its current effective binding (or "unbound" if the user cleared it).
 *   - \`{{key:mod+b}}\` — a fixed, non-rebindable combo (e.g. the Markdown editor's
 *     formatting keys); resolves to the platform-formatted form only.
 *
 * AI content is gated by the "Hide AI features" setting:
 *   - A whole section with \`ai: true\` is dropped from the guide when AI is hidden.
 *   - An inline passage wrapped in \`{{ai}}…{{/ai}}\` is stripped when AI is hidden
 *     (and the markers alone are stripped when AI is on).
 * HelpScreen resolves all of this before rendering.
 */
export interface GuideSection {
  id: string;
  /** Left-nav label. */
  label: string;
  /** AI-only section: hidden when "Hide AI features" is on. */
  ai?: boolean;
  /** Markdown body (with {{kbd:…}} / {{key:…}} / {{ai}}…{{/ai}} tokens). */
  body: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "getting-started",
    label: "Getting started",
    body: `# Welcome to GitDesktop

GitDesktop is a desktop Git client{{ai}} with AI built in{{/ai}}: GitHub Desktop-style
fundamentals — status, staging, branches, history, diffs, sync — plus the full
pull-request lifecycle, GitHub Actions, issues, discussions, releases, repository
insights{{ai}}, and write-capable AI agent sessions{{/ai}}, all in one app.

A few things worth knowing up front:

- **Git is required.** GitDesktop drives your system \`git\`, so anything it does is
  standard Git you could do on the command line.
- **GitHub features use the GitHub CLI (\`gh\`).** Pull requests, issues, discussions,
  Actions, and repository settings appear once \`gh\` is installed and you've run
  \`gh auth login\`. There's no separate sign-in, and the app never stores your tokens.
  Plain Git (clone/fetch/pull/push) works against any remote without GitHub.
- **GitHub Enterprise works too.** GitDesktop follows \`gh\`, which detects each repo's
  host from its remote — so sign in to your Enterprise server with
  \`gh auth login --hostname your.github.example\` and its repos get the same PR, issue,
  and Actions features. **Settings → Accounts** lists every signed-in host and lets you
  switch the active account per host.
{{ai}}- **AI is optional.** Commit messages, PR descriptions, reviews, CI debugging, and
  agent sessions can use Anthropic, OpenAI, OpenRouter, Ollama (local or cloud), an
  OpenAI-compatible endpoint, or the Claude Code / Codex / GitHub Copilot / opencode
  CLIs. You can hide every AI feature in **Settings → General**.
{{/ai}}
## Open your first repository

From the welcome screen (or the repo switcher in the header):

- **Open repository** ({{kbd:add-local-repository}}) — point at a folder that's already
  a Git repo.
- **Clone repository** ({{kbd:clone-repository}}) — clone from a URL, or browse and
  clone your **GitHub** or **GitLab** repos from their tabs.
- **Create repository** ({{kbd:new-repository}}) — start a new repo with an optional
  README, \`.gitignore\`, and license.

## Finding your way around

Once a repo is open you land on the **Changes** tab. The header's tab rail holds the
four primary views — **Changes**, **History**, **Compare**, and **Pull Requests** —
and a **More ▾** menu holds the rest: {{ai}}**Agent**, {{/ai}}**Issues**,
**Discussions**, **Actions**, **Tags**, and **Insights**. The More button shows the
active secondary tab's name, so the rail always says where you are.

Switch tabs with the number keys ({{kbd:tab-changes}} through {{kbd:tab-insights}}; see
*Keyboard & navigation*). Issues, Discussions, Actions, and Tags need \`gh\` and a GitHub
remote{{ai}}; the **Agent** tab appears only when AI features are enabled{{/ai}}.

> Tip: press {{kbd:command-palette}} anytime for the command palette — the fastest way
> to find a feature when you don't know where it lives — or {{kbd:show-help}} to reopen
> this guide.`,
  },
  {
    id: "repositories",
    label: "Repositories",
    body: `# Repositories

## Switching repos

The repository name in the header is a **switcher** ({{kbd:show-repositories}}). Click it
to see every repo you've opened, grouped by GitHub owner, with a Recent section and a
filter box — jump between repos without returning to the welcome screen.

## The repository menu

Click the **⋮** menu next to the repo name for repo-wide actions:

- **View on GitHub** ({{kbd:view-on-github}}), open a **terminal** at the repo root
  ({{kbd:open-in-terminal}}), **show in your file manager** ({{kbd:show-in-explorer}}),
  or **open in your editor** ({{kbd:open-in-editor}}).
- On GitHub: **Star** the repository, **create an issue**, or **Fork** it.
- **Insights** (analytics), **manage files**, **submodules**, the **remote URL**,
  **branch rules**, **git hooks**, {{ai}}**automations**, {{/ai}}**repository settings**,
  an **alias**, copy the repo path, and remove the repo from the list.

## Aliases

An **alias** gives a repo a friendly name shown in the lists, header, and window title —
handy when several repos share a name. For repository statistics and analytics (commits,
contributors, language makeup, activity, traffic), open **Insights** from the menu or the
**Insights** tab.

The app remembers each window's **position and size** across launches, including which
monitor it was on — see **Settings → About** for the current coordinates.`,
  },
  {
    id: "repo-settings",
    label: "Repository settings",
    body: `# Repository settings

**Repository settings** (the repo ⋮ menu) manages your GitHub repository without leaving
the app. It's organized as a sidebar of grouped sections; changes apply on GitHub
immediately unless noted.

- **General** — description, topics, homepage, default branch, features (issues,
  projects, wiki, discussions), pull-request merge options (allowed merge methods,
  default squash/merge commit messages, auto-merge, delete-branch-on-merge), template
  repository, and (on org-owned private repos) allow-forking.
- **Access** — collaborators and their roles; invite someone at any level
  (Read / Triage / Write / Maintain / Admin), change a role inline, remove access, and
  manage pending invitations.
- **Rules** — GitHub's branch **rulesets**: list them, flip enforcement
  (Active / Evaluate / Disabled), and create or edit one (require a PR with approvals /
  code-owner review, required status checks, block force pushes, restrict deletions,
  linear history, signed commits).
- **Security** — secret scanning (with AI detection and non-provider-pattern
  sub-toggles), push protection, code scanning, Dependabot alerts and security updates,
  and private vulnerability reporting, behind a save/discard bar. Dependabot **version
  updates** scaffolds a \`.github/dependabot.yml\` for you to commit.
- **Pages** — enable GitHub Pages from a branch + folder or via Actions, set a custom
  domain, enforce HTTPS, and see the live URL and build status.
- **Sponsor** — edit \`.github/FUNDING.yml\` (GitHub Sponsors, Patreon, Open Collective,
  Ko-fi, and more); saving writes the file to your working tree to commit.
- **Secrets** — Actions, Dependabot, and Codespaces **secrets** plus Actions
  **variables**, at repository or environment scope. Values are encrypted on your
  machine and, as on GitHub, can't be read back — only replaced or removed.
- **Webhooks** — add, edit, and remove webhooks; pick events, send a ping or test
  delivery, and inspect recent **deliveries** with their request/response payloads.
- **Danger zone** — **rename**, **archive / unarchive**, **change visibility**,
  **transfer ownership**, and **delete** the repository. The three irreversible actions
  are each behind a type-the-\`owner/repo\`-name confirmation, and your local clone is
  never touched.

> Some options GitHub exposes to no app appear as **"Manage on GitHub"** links rather
> than dead toggles.`,
  },
  {
    id: "changes",
    label: "Changes, diffs & commits",
    body: `# Changes, diffs & commits

The **Changes** tab ({{kbd:tab-changes}}) lists your modified files, split into
**Staged** (included in the next commit) and **Changes** (not yet staged).

## Staging

- Click a file to see its diff. Toggle **unified / split** at the top of the diff.
- Stage or unstage a file with the **+ / −** button on its row, or **Stage all**.
- **Hunk-level staging** — in a file's diff, each hunk has its own Stage / Unstage /
  Discard buttons.
- **Line-level staging** — drag across the line-number gutter to select specific lines,
  then stage or discard just those.
- Select multiple files ({{key:mod}}-click, or Shift-click for a range), then right-click
  for **Stage / Unstage / Discard / Stash** of the whole selection.
- Filter the list by path, or by category (new / modified / deleted, included /
  excluded) with the funnel button.

## The diff viewer

- **Syntax highlighting** for most languages, with a per-file **language override** if a
  file is detected wrong (or turn highlighting off).
- **Image diffs** render side by side.
- Very large diffs are capped (with a **Show full diff** escape hatch) so a huge file
  never freezes the view.

## Committing

Write a **summary** (there's a 72-character budget indicator) and an optional
**description**, then **Commit** ({{kbd:commit}}).

- **Co-authors** — add collaborators; the picker suggests people from the repo's history
  and writes proper \`Co-authored-by:\` trailers.
{{ai}}- **Generate with AI** ({{kbd:generate-commit-message}}) — write the summary and
  description from your staged diff (see *AI & automations*).
{{/ai}}- After committing, **Undo** ({{kbd:undo-commit}}) reverses the last commit and
  returns your message to the box.

> Discarding an **untracked** file moves it to the recycle bin, so it's recoverable —
> it isn't deleted outright.`,
  },
  {
    id: "history",
    label: "History & git operations",
    body: `# History & git operations

The **History** tab ({{kbd:tab-history}}) is the commit log for the current branch. Click
a commit to see its message, author, and full diff; **Shift + ↑ / ↓** extends the
selection to compare a range.

## Commit actions

Right-click a commit (or use the commit detail view) for:

- **Amend** the most recent commit (reword, or fold in staged changes).
- **Revert** — create a new commit that undoes a commit's changes.
- **Cherry-pick** a commit onto the current branch.
- **Reset** the current branch to a commit — a **mixed reset**, so the changes from later
  commits return to your working tree as uncommitted changes.
- **Edit history** — open the interactive-rebase editor over your unpushed commits, where
  each commit gets an action: **pick** (keep), **reword** (edit its message), **squash**
  (merge into the commit below, combining messages), **fixup** (merge in, keeping the
  message), **edit** (pause to amend its changes), or **drop** (remove it) — plus **↑/↓** to
  reorder.{{ai}} Reword can regenerate a message with AI.{{/ai}} A "Result" count shows what
  you'll end up with. With no **edit**, it applies all at once and rolls back untouched if
  anything conflicts. If you choose **edit**, it starts a rebase that **pauses** at that commit —
  amend it in the **Changes** tab (stage and commit/amend as usual), then **Continue** from the
  banner there. A quick **Squash N commits…** is also on the context menu when you select
  adjacent commits.
- **Create a branch** or **create a tag** at a commit, **check out** a commit, or copy
  its SHA.

## Exploring a file's past

- **File history** — see every commit that touched a specific file.
- **Blame** — line-by-line, which commit last changed each line.

> History-rewriting actions (reset, Edit history, squash) only ever touch **unpushed**
> commits, and a push of rewritten history becomes a safe **force-with-lease** push (see
> *Syncing & conflicts*).`,
  },
  {
    id: "branches",
    label: "Branches & compare",
    body: `# Branches & compare

The branch name in the header opens the **branch switcher** ({{kbd:show-branches}}).

- Branches are sorted by most recent commit, with the default branch pinned on top and
  each branch's ahead/behind counts vs. the default.
- **Create** a branch ({{kbd:new-branch}}), **rename** ({{kbd:rename-branch}}), **delete**
  ({{kbd:delete-branch}}), or **archive** it — archiving hides a branch without deleting
  it, collapsing it into an "Archived" section.
{{ai}}- **Generate a branch name with AI** from your working-tree changes when creating
  one.
{{/ai}}- Switching with **uncommitted changes** prompts you to bring them along or stash
  and switch.
- Right-click a branch to **merge**, **squash and merge**, **rebase**, or **update it
  from the default branch** ({{kbd:update-from-default}}) — the last *without* checking it
  out.
- The **Merge** dialog previews the result before you commit to it — *fast-forward*, *clean
  merge*, or *which files will conflict* — worked out in memory without touching your files.
  Two options sit alongside: **Always create a merge commit** (no fast-forward), and an **On
  conflict** strategy — *Stop and let me resolve* (default), or *Prefer current* / *Prefer
  incoming* to auto-resolve conflicting changes in one branch's favor (the other side's
  conflicting changes are dropped, so it's used deliberately).

## Stash

**Stash all changes** ({{kbd:stash-all}}) sets your working changes aside; **View
stashes** lists them to apply, pop, or drop, and **Pop latest stash** restores the most
recent.

## Compare

The **Compare** tab ({{kbd:tab-compare}}) lets you pick any base branch and see what the
current branch adds: the commits ahead and behind, and the full three-dot diff a PR would
show. From here you can merge, rebase, or jump straight to opening a pull request.

## Branch rules

**Branch rules…** (in the ⋮ menu) sets local protections — naming patterns, blocked
deletion, allowed merge methods, require-PR, and force-push blocking. They're enforced
inside the app, can be shared with your team via a committed file, and can be imported
from a repo's GitHub branch-protection rules. (For server-side enforcement, use **Rules**
in *Repository settings*.)

## Worktrees

**Worktrees…** (in the ⋮ menu, or the command palette) manages linked worktrees — extra
folders that each check out a different branch of the same repository, so you can build,
test, or review several branches at once without stashing or switching.

- **Add** a worktree on a new branch (from any base) or an existing one; it's checked out
  into its own folder, defaulting to a sibling of the repository.
- **Open** a worktree to make it the active repository — git commands then run in that
  folder and the window title follows. Open the main worktree to switch back.
- **Rename** a worktree to move its folder to a new name in place; its branch is unchanged.
- **Lock** a worktree (with an optional reason) so git won't prune or remove it without a
  forced confirmation — useful for one on a removable or network drive; **Unlock** to undo.
- **Delete** a worktree to remove its folder; its branch is kept. A worktree with
  uncommitted changes asks before force-removing. The main worktree, and whichever one
  you're currently in, can't be renamed or deleted — switch away first.
- **Repair links** (footer) re-connects worktrees if you moved or renamed the repository
  folder in your file manager, which otherwise breaks the path each worktree records.

A branch can only be checked out in one worktree at a time, so the list excludes branches
already in use. The **branch switcher** knows this too: a branch that's checked out in
another worktree is badged, and choosing it offers to open that worktree instead of failing
with a checkout error.{{ai}} Worktrees that AI agent sessions use internally are hidden here.{{/ai}}`,
  },
  {
    id: "syncing",
    label: "Syncing & conflicts",
    body: `# Fetch, pull, push & conflicts

The header shows **Fetch / Pull / Push** with ahead/behind indicators.

- **Fetch** ({{kbd:fetch}}) updates your view of the remote without changing your branch.
- **Pull** ({{kbd:pull}}) is fast-forward only by design — it won't create surprise merge
  commits.
- **Push** ({{kbd:push}}) sends your commits. For a branch with no upstream yet, you'll
  see **Publish branch** instead.

## Auto-fetch

By default, GitDesktop quietly fetches in the background so the ahead/behind counts stay
current without pressing **Fetch**. It runs on an interval while the window is focused, and
once more when you return to the app or open a repo. It only updates your view of the remote
— it **never pulls, merges, or changes your files**, so pulling and pushing stay deliberate.
There are no toasts; the **Fetch** button simply spins while it works, and hovering it shows
when the repo was last fetched. Turn it off, or change the interval, under
**Settings → General**.

## Safer force push

If your local history was rewritten (for example, after amending a commit that was
already pushed), GitDesktop detects the divergence and turns Push into a **confirmed
force push using \`--force-with-lease\`** — which refuses to clobber work someone else
pushed in the meantime.

## Resolving conflicts

During a **merge**, **rebase**, or **cherry-pick**, a slim banner appears in **Changes**
with the conflict count and **Abort** / **Finish** controls. Select a conflicted file (the
\`!\` badge) to open the **conflict editor**: each conflict region shows **Current (ours)**
over **Incoming (theirs)** with **Accept current**, **Accept incoming**, or **Accept both**,
and the header adds whole-file **Accept all current** / **Accept all incoming** and **Open in
editor**. Files mark themselves resolved as you go — the \`!\` badge clears — and **Finish**
stays disabled until every conflict is resolved.

{{ai}}## Resolve conflicts with AI

Select a conflicted file and click **Resolve with AI** in the conflict editor's header (also
on the file's right-click menu, and via the command palette ({{kbd:command-palette}})). Your configured
**Review** model (Settings → AI) merges the file's sides and streams a proposal; you review
it as a diff against your side, flip to the proposed file or the *ours* / *theirs* / *base*
versions, then **Accept & stage** to apply it — nothing is written until you accept.
**Regenerate** for another attempt, or **Discard** to drop it. The banner's **Resolve all
with AI** walks every conflict in turn. It runs on any provider, including local Ollama and
keyless Claude Code / Codex agents, and skips files matched by your AI ignore patterns.{{/ai}}`,
  },
  {
    id: "pull-requests",
    label: "Pull requests",
    body: `# Pull requests

The **Pull Requests** tab ({{kbd:tab-pulls}}) manages GitHub PRs, GitLab merge requests,
and local PRs. (Hosted PRs/MRs need the matching CLI — \`gh\` or \`glab\` — installed and
authenticated.)

## GitHub PRs

Browse open/closed PRs and open one in a full in-app view: description, commits, changed
files with diffs, and CI checks. From there you can **comment** (with quote-reply),
**review** (approve / comment / request changes), **edit** the title and body, manage
**labels**, mark a draft **ready**, **merge** (merge commit, squash, or rebase, with
optional branch deletion), and **close**.

Comments, replies, edits, and descriptions use a Markdown editor with **Write / Preview**
tabs and a formatting toolbar (bold, italic, headings, quote, code, links, and bulleted
/ numbered / task lists, with {{key:mod+b}} / {{key:mod+i}} / {{key:mod+k}}). The same
editor is everywhere you write Markdown — issues, discussions, and release notes.

Create a PR with **Create pull request** ({{kbd:create-pr}}) or from the Compare tab — as
a **draft** if you like{{ai}}, optionally with an **AI-generated** title and description
from the branch diff and commit subjects{{/ai}}.

## GitLab merge requests

Point the app at a **GitLab** repo and the same tab lists its **merge requests** (open and
closed/merged) next to any local PRs. Open one for the description, comments, commits, and a
highlighted **diff** (with an **Open on GitLab** link) — and the **first GitLab MR writes**:
**comment** on it, **close / reopen** it, **approve / unapprove** it (a reviewer action,
with the approval count shown inline), edit its **labels**, and **merge** it — merge or squash, optionally deleting
the source branch, guarded so it never merges a head you didn't see (GitLab applies the project's
configured merge method, so there's no separate "rebase" option). **Creating a merge request**
works from the app too ({{kbd:create-pr}}, the New menu, or the Compare tab) — it pushes your
branch and opens the MR, with the same draft checkbox and AI description as GitHub. Full
reviews (a comment or request-changes with a body) are coming soon; for now those live on
GitLab. GitLab uses the GitLab
CLI (\`glab\`) — run \`glab auth login\` once, no tokens stored. Its issues, CI pipelines, and
releases read too (see their sections below).

## Local PRs

A **local PR** is the same review workflow against any two branches with **no remote at
all** — describe it in Markdown, comment, label, approve, and merge locally. Local PRs
are private to you and never written into the repo. When you're ready, **promote** a
local PR to a real GitHub PR or GitLab MR in one click, history preserved.
{{ai}}
## AI review

On any PR, run a streamed **code review** or a focused **security audit** of its changes
using your chosen review model, and optionally post the result as a comment. A general
review can build on prior reviews as soft context. With a CLI agent (Claude, Copilot, or
opencode), a **repo-aware** toggle lets the reviewer read the repo's files for deeper
context (slower). See *AI & automations* to pick the review model.{{/ai}}`,
  },
  {
    id: "issues",
    label: "Issues",
    body: `# Issues

The **Issues** tab ({{kbd:tab-issues}}, in the More ▾ menu) manages GitHub issues, GitLab
issues, and private local issues. (The **GitLab issues** section below covers exactly which
GitLab actions are available.)

## GitHub issues

Browse, filter, and open issues in a full view: body, comments, labels, assignees,
milestone, and reactions. **Create** an issue, comment with the Markdown editor, edit,
add labels, **close / reopen**, **lock**, and **transfer** an issue to another repo.

- **Sub-issues** — break an issue into a parent/child checklist with completion tracking.
- **Dependencies** — link issues as blocked-by / blocking.
- **Development** — see linked PRs and branches, and **create a branch** wired to the
  issue.

## GitLab issues

Point the app at a **GitLab** repo and the same tab lists its **issues** (open and closed)
next to any local issues. Open one to read the description and comments with a side rail of
labels, assignees, and milestone — and GitLab issue **writes**: **comment** on the issue,
**close / reopen** it, and edit its **labels** and **assignees** right in the side rail.
**Creating issues** works too — the New menu (or {{kbd:create-issue}} from the palette) opens
the same dialog GitHub uses, with labels and assignees (milestone and type are GitHub-only
pickers). Editing the title/body still lives on GitLab for now (use the **View on GitLab**
link); the milestone stays read-only.

## Local issues

A **local issue** is a private, offline to-do tracked in the app — create, edit, label,
and close it with no remote. When it's ready to share, **promote** it to a GitHub or
GitLab issue in one click.
{{ai}}
## Hand off to an agent

From an issue, **Solve with agent** starts a write-capable agent session framed around
that issue (see *Agent sessions*).{{/ai}}`,
  },
  {
    id: "discussions",
    label: "Discussions",
    body: `# Discussions

The **Discussions** tab ({{kbd:tab-discussions}}, in the More ▾ menu) browses and takes
part in GitHub Discussions for the repo. (Discussions must be enabled on the repo.)

- Read **threaded conversations** — top-level comments with nested replies — and post,
  edit, delete, or hide comments with the Markdown editor.
- In a Q&A discussion, **mark a reply as the answer**.
- Add **reactions** and upvotes.
- Manage a discussion's lifecycle: **close** (as resolved / outdated / duplicate),
  **reopen**, **lock**, and **delete**.
- **Create a discussion**, or **create an issue from a discussion** when a thread turns
  into actionable work (the new issue links back to it).`,
  },
  {
    id: "releases",
    label: "Releases & tags",
    body: `# Releases & tags

The **Tags** tab ({{kbd:tab-tags}}, in the More ▾ menu) manages your repository's tags and
releases — GitHub releases (full read/write) and **GitLab** releases (read-only, see below).

- See every tag and **create a tag** (also available from a commit in History).
- **Create a release** from a tag: set the title and notes, mark it a **pre-release** or
  **draft**, and publish. Releases show badges (**Latest**, **Pre-release**, **Draft**).
{{ai}}- **Generate release notes with AI** — draft the notes from the commits and
  changelog between this tag and the previous one, then edit before publishing.{{/ai}}

## GitLab releases

Point the app at a **GitLab** repo and the **Tags** tab lists its **releases** alongside your
local tags (release rows carry the **Latest** badge). Open one for a **read-only** view: the
release **notes**, who published it and when, and any **asset links** — click to open them in
your browser. Publishing, editing, or deleting releases from the app is coming soon; for now
those actions live on GitLab.`,
  },
  {
    id: "actions",
    label: "GitHub Actions",
    body: `# GitHub Actions

The **Actions** tab ({{kbd:tab-actions}}, in the More ▾ menu) is a cockpit for your GitHub
Actions workflow runs (needs \`gh\` + a GitHub remote). **GitLab pipelines** show here too,
read-only (see below).

- The list shows recent runs with live status, refreshing while any run is active. Filter
  by text or scope to the current branch.
- Click a run to see its **jobs and steps** with status and durations.
- **Re-run all jobs**, **Re-run failed jobs**, or **Cancel** an in-progress run.
- **Run workflow…** manually dispatches a workflow (one with a \`workflow_dispatch\`
  trigger) on a branch you choose, including any **input parameters** it defines.
- For a failed job, expand **failed-step logs** inline.

## GitLab pipelines

Point the app at a **GitLab** repo and the same tab lists its **pipelines** — newest first,
filterable, optionally scoped to the current branch — with the header CI badge tracking the
latest one. Open a pipeline for a **read-only** view of its **jobs** (status + durations);
expand a job for its **log**. Re-running, cancelling, and dispatching pipelines from the app
is coming soon; for now those actions live on GitLab.
{{ai}}
## Debug with AI

On a failed job, **Debug with AI** reads that job's logs and streams a diagnosis: the
likely **root cause**, a concrete **fix**, and — at the end — a ready-to-paste **agent
prompt** you can hand to a coding agent to implement the fix. Copy just that prompt with
**Copy fix prompt**.

{{/ai}}A small **CI badge** in the header tracks the current branch's latest run; click it
to jump to that run. You can also get an OS **notification** when a run finishes
(**Settings → Notifications**).`,
  },
  {
    id: "insights",
    label: "Insights",
    body: `# Insights

The **Insights** tab ({{kbd:tab-insights}}, in the More ▾ menu) is a dashboard of
repository analytics, mixing local Git history with GitHub data.

- **Repository statistics** — commits, contributors, branch and tag counts, sizes, and a
  language-makeup bar.
- **Commit activity** — commits per week, and a **code-frequency** chart of additions and
  deletions over time.
- **Top contributors** and a **punch card** heatmap of commits by day and hour.
- **Community health** — stars, forks, watchers, and a health percentage.
- **Actions usage** — recent run duration and success rate.
- **Traffic** — 14-day views, clones, and top referrers (needs push access).
- **Dependencies** — what the repo depends on.
- Quick links jump to the matching GitHub pages (Pulse, Network, Forks, Dependents,
  Actions) for anything best viewed there.`,
  },
  {
    id: "agent",
    label: "Agent sessions",
    ai: true,
    body: `# Agent sessions

The **Agent** tab turns a configured CLI agent (Claude Code, Codex, GitHub Copilot, or
opencode) into a hands-on teammate that can **research**, **plan**, and **implement** changes
for you — safely, in an isolated copy of your repo. It appears when AI features are enabled.

The **sidebar** lists your research, plans, and sessions. Each carries a stable **#N**
identifier, so an entry can point at what it became — a research run shows the **plan** it
turned into (*Turned into plan #12*), and a plan shows the **session** that implemented it
(*Implemented · Ready to review #10*). Each row also shows its **provider · model**;
**right-click** for a row's actions — a plan's include opening its **session** or filing it as
a **local issue**. The **step-by-step activity log** of each entry is kept across restarts.

## Research a topic (read-only)

**Research** runs a read-only, **web-enabled** agent that explores the web *and* your repo,
then streams a **cited report** right here in the app. Pick an intent — and switch between
them anytime from the follow-up composer, the way you'd switch a model:

- **Brainstorm** — breadth-first. Surveys what's out there and surfaces several distinct
  directions with rough tradeoffs and prior art (who else does this), so you can widen your
  options before committing to one.
- **Deep research** — depth-first. Investigates one direction rigorously — feasibility,
  approaches, libraries, tradeoffs — grounded in primary sources, with a confidence note per
  major claim and an explicit "what I couldn't verify".

The natural flow: start in **Brainstorm** to widen your options, then **switch to Deep
research** to flesh out the direction you chose — the whole conversation carries over, so the
agent keeps everything it already explored. Keep refining with follow-up messages; the agent
keeps its sources in context. When a report is ready you can **Turn it into a Plan** (it
carries the whole session over as the goal to converge) or **Save report** as a local Markdown
file (written to \`.gitdesktop/research/\` for you to review and commit — never committed for
you). It's **read-only**: it searches and reads, but never changes your code. Pick any agent —
**Claude**, **Codex**, **GitHub Copilot**, or **opencode** — each uses its own native web search
and fetch. (opencode's web *search* needs its Exa integration enabled — web *fetch* always works.)

## Plan a task (read-only)

**Plan a task** runs a read-only agent that explores the current repo and drafts an
**agent-ready issue** — context, approach, affected files, acceptance criteria, and a
test plan. It can ask clarifying questions; answer them and it refines the plan in the
same conversation. The cited file paths are validated against the repo, so the plan stays
grounded. From a finished plan you can **file it as a GitHub or local issue**, or **hand
it straight to an implementing session**.

## Delegate a task

**Delegate** starts a write-capable session. Describe the task, pick the **agent**,
**model**, and **reasoning effort** (Low / Medium / High / Max), and send. The agent works
in an **isolated git worktree** — a throwaway branch (\`gd/session/…\`) that never touches
your working tree — and commits a **checkpoint** each turn. It works in the open: the
conversation shows a **step-by-step transcript** of each file it reads, edits, searches,
and command it runs, interleaved with its narration. **Expand any edit step** to see that
file's diff inline, watch its **live changes** mid-turn, or read the cumulative diff under
**Changes**.

In the composer you can:

- Reference a file with **@** (autocomplete), so the agent reads the right file.
- Run a **slash command** — built-ins like \`/review\`, \`/test\`, \`/fix\`, \`/explain\`,
  and \`/refactor\`, plus the selected CLI's own commands (such as \`/plan\` with Copilot
  or Codex) and your project's custom commands and **skills**.
- Opt into **MCP servers** for the session from the **MCP** picker (appears once you've
  registered some — see below).
- Continue the conversation across turns; **↑ / ↓** recall previous prompts.

## MCP servers

Register **Model Context Protocol** servers under **Settings → MCP servers** — local
(\`stdio\`) processes or remote (HTTP) endpoints, with environment variables / headers and
**secrets kept in your OS keychain**, never in your settings file. Each session opts into
the ones you choose from the composer's **MCP** picker. **Claude**, **Copilot**, and
**opencode** run MCP servers on the **host** *or* in a **container**; **Codex** runs them
in a **container** only (local/\`stdio\` servers — host Codex can't approve MCP tool calls,
so it needs the container's sandbox). In a container the servers run *inside* the sandbox,
sharing an npm cache so an \`npx\` server is downloaded only once. A Claude run is **strict** —
it gets *only* the servers you picked and never inherits others on your machine — while
Copilot and opencode layer your picks onto their own config. The composer's **MCP** picker
shows for every agent and tells you when to switch isolation. You can also change the
selection **mid-session** — the picker appears in a running session's reply box too, and a
new choice applies from your next turn.

**The other direction — GitDesktop *as* a server.** At the bottom of the panel, **Use
GitDesktop as an MCP server** gives you a ready-to-paste config snippet so any external MCP
client — Claude Desktop, Cursor, Claude Code — can use *this* repo's **read-only** git &
GitHub tools (status, log, diffs, blame, branches, file history/read, PRs, issues, CI logs).
The app itself runs as a stdio server (\`gitdesktop mcp --repo <path>\`) exposing only read
tools, so an agent can understand a repo without changing it. Copy it, paste it into your
client's MCP config, done.

New to MCP? **Browse** opens the official Model Context Protocol registry right in that
panel — search it and add a server in a click; it arrives **disabled** for you to review
and enable. You can also reach it from the command palette (*Browse MCP registry*). Each
result carries signals to vet a server first — **GitHub stars** and last-updated, weekly
**npm installs**, deprecation status, and (when you expand it) the source repo plus exactly
**what it runs or connects to** and which secrets it needs. Toggle between two sources: the
**official registry** and **GitHub** (repositories tagged \`mcp-server\`, ranked by stars).
GitHub results are rougher — ones with a manifest add cleanly, the rest arrive marked
*needs setup* for you to finish.

Already have servers configured? Use **Import** in that panel to pull them in from the
open repo's \`.mcp.json\` or your global Claude config — you pick which ones, they arrive
**disabled** for you to review, and any secret-looking values are moved to your keychain.
Nothing is inherited automatically; the source files are left untouched.

Each server is **scoped** either **Global** (every repo) or to **one repo** — import sets
this from where the server came from, and you can change it when editing. The panel groups
the list accordingly, and a repo-scoped server only appears in that repo's session picker,
so the registry stays tidy as it grows.

When you open Settings **with a repo active**, each global server's row shows a per-repo
control: **On** (available and pre-selected here), **Optional** (available but off by
default), **Off** (not offered in this repo), or **Default** to follow its global setting.
That lets you keep a shared server on in one repo and off in another without touching the
others.

## Run several ways at once (Best-of-N)

**Best-of-N** runs the same task across 2–5 arms, each with its own agent, model, and
effort — so different providers attack the problem from different angles. Each arm runs in
its own worktree; review them side by side and **keep the best one** (it discards the
rest). Because fanning out costs real money, you get an upfront cost estimate first.

## Isolation

Every session is sandboxed. By default it runs in a **worktree** (a separate working copy
on a session branch). Optionally, run it inside a **Docker or Podman container** for a
stronger sandbox — with a built-in **terminal** ({{kbd:agent-toggle-terminal}}) running
*inside* the container, where you choose which dev-server port(s) to publish before it
starts. Set the default in **Settings → AI**.

## Finishing up

A session shows its **cost** per turn. When you're happy, **Keep** it (squashes the
checkpoints onto its branch and frees the worktree); **Resume** later to keep going;
**Discard** to throw it away; or turn a kept session into a **local PR**. Sessions persist
across restarts, split into **Active** and **Kept** tabs with search.

> Provider and model are chosen per session. Switching providers mid-session isn't
> supported (each CLI keeps its own conversation), but you can change the model within a
> provider between turns.`,
  },
  {
    id: "ai",
    label: "AI & automations",
    ai: true,
    body: `# AI & automations

GitDesktop uses AI for commit messages, branch names, PR titles/descriptions, issue and
release drafts, PR reviews, CI debugging, and agent sessions. It's entirely optional and
configured in **Settings → AI**.

## Providers

Bring your own model:

- **Anthropic, OpenAI, OpenRouter, Ollama Cloud** — paste an API key (stored in your OS
  keychain, never in app files).
- **OpenAI-compatible** — any endpoint that speaks the OpenAI API, with one-click presets
  for **Vercel AI Gateway, Google Gemini, DeepSeek, Mistral, and Z.ai (GLM)**.
- **Ollama (local or LAN)** — a local model (your code never leaves your machine), or one
  running on another machine on your network — set its URL in Settings.
- **Claude Code, Codex, GitHub Copilot, opencode CLIs** — *keyless*: they reuse your
  existing CLI login, with no API key. The CLI agents are **write-capable** — they power
  agent sessions and plan mode — and can read repo files for deeper reviews.

You can set **separate models** for generation (commit/PR messages) versus review.

**Custom & LAN servers — allowed hosts.** To reach an Ollama or OpenAI-compatible server
that isn't \`localhost\` (a box on your network, or a self-hosted endpoint), enter its URL in
Settings → AI and add its host to the **Allowed hosts** list — or click **Allow host** on the
prompt that appears next to a not-yet-permitted URL. Built-in providers and \`localhost\` are
always allowed; every other host must be on your list, which GitDesktop checks before each AI
request so it never reaches a server you didn't authorize.

## Generation

AI streams into the same inputs you'd type in, so it's always editable: **commit
messages**, **branch names**, **PR titles and descriptions**, **issue drafts**, **release
notes**, and **repository descriptions**.

## Instructions & privacy

- **Instructions** steer every generation. Set **global** instructions in Settings (e.g.
  "Follow Conventional Commits"), or add a per-repo \`.gitdesktop/instructions.md\` that
  takes precedence.
- **AI-ignore patterns** keep sensitive or noisy files (lockfiles, vendored folders) out
  of the AI's context while still committing them normally — global in Settings, or
  per-repo via \`.gitdesktop/aiignore\`.
- **Hide AI** (Settings → General) removes every AI surface from the app while keeping
  your configuration.

## Automations

**Automations** (Settings → Automations, with per-repo overrides in the repo ⋮ menu) run
an AI action automatically on a trigger — for example, drafting a description when a PR is
opened — so routine generation happens without you asking.`,
  },
  {
    id: "hooks",
    label: "Git hooks",
    body: `# Git hooks

**Git hooks…** (in the repo ⋮ menu) manages the scripts in your repo's \`.git/hooks\` —
the small programs Git runs at points like *before commit* or *before push*.

- See every hook with its state (active / disabled / inactive) and **edit** it in a
  built-in editor.
- **Enable or disable** a hook without deleting it, or delete it outright.
- **Templates** give you a one-click starting script for any of the standard hooks
  (pre-commit, commit-msg, pre-push, …).
- If your repo uses a hook manager — **husky**, **pre-commit**, or **lefthook** —
  GitDesktop detects it, opens its config, and can run the right install/update command
  for you.`,
  },
  {
    id: "keyboard",
    label: "Keyboard & navigation",
    body: `# Keyboard & navigation

GitDesktop is built to be driven from the keyboard. The shortcuts below show your current
bindings (formatted for your platform) — rebind any of them in **Settings → Keyboard**.

- **Command palette — {{kbd:command-palette}}.** Search and run any action available right
  now. The fastest way to find a feature when you don't know where it lives.
- **Keyboard shortcuts — {{kbd:show-shortcuts}}.** A cheat sheet of every shortcut, always
  reflecting your customizations.

## Moving around

- **↑ / ↓** navigate every list — files, commits, branches, PRs, runs, sessions, and the
  side rails (Settings, Repository settings, and this guide). **Shift + ↑ / ↓** extends a
  selection in History. **Enter** opens the highlighted item; **Esc** closes dialogs and
  menus.
- **Tabs:** {{kbd:tab-changes}} Changes · {{kbd:tab-history}} History ·
  {{kbd:tab-compare}} Compare · {{kbd:tab-pulls}} Pull Requests · {{kbd:tab-actions}}
  Actions · {{kbd:tab-issues}} Issues · {{kbd:tab-discussions}} Discussions ·
  {{kbd:tab-tags}} Tags · {{kbd:tab-insights}} Insights.{{ai}} The **Agent** tab is
  palette-only by default (bind a key in Settings).{{/ai}}
- {{kbd:show-repositories}} repositories · {{kbd:show-branches}} branches ·
  {{kbd:back-to-repositories}} back to repositories · {{kbd:focus-filter}} focus the
  filter.

## Doing things

- **Repository:** {{kbd:push}} push · {{kbd:pull}} pull · {{kbd:fetch}} fetch ·
  {{kbd:open-in-terminal}} terminal · {{kbd:show-in-explorer}} file manager ·
  {{kbd:open-in-editor}} editor · {{kbd:view-on-github}} GitHub · {{kbd:new-repository}}
  new repo · {{kbd:add-local-repository}} add local · {{kbd:clone-repository}} clone.
- **Branches & stash:** {{kbd:new-branch}} new · {{kbd:rename-branch}} rename ·
  {{kbd:delete-branch}} delete · {{kbd:update-from-default}} update from default ·
  {{kbd:stash-all}} stash all.
- **Changes:** {{kbd:commit}} commit{{ai}} · {{kbd:generate-commit-message}} generate
  commit message{{/ai}} · {{kbd:undo-commit}} undo last commit.
- **Pull requests:** {{kbd:create-pr}} create pull request.
{{ai}}- **Agent:** {{kbd:agent-toggle-terminal}} toggle the session terminal.
{{/ai}}
Every shortcut is **rebindable** in **Settings → Keyboard**: click a binding, press a new
combination, and if it clashes with another action the app moves it for you. Many actions
(creating issues/releases, repository settings, stash views{{ai}}, most agent
commands{{/ai}}) are palette-only until you bind a key. Defaults match GitHub Desktop where
there's an equivalent.`,
  },
  {
    id: "settings",
    label: "Settings & updates",
    body: `# Settings & updates

Open **Settings** from the header gear (or {{kbd:open-settings}}). Sections:

- **General** — hide AI features, keep running in the **system tray** on close (so
  background work continues), and privacy options.
{{ai}}- **AI** — providers, models, keys, instructions, agent-session isolation
  (worktree / container), and the container image.
- **Slash commands** — manage built-in and custom agent commands.
- **MCP servers** — register Model Context Protocol servers (secrets in your OS keychain)
  that agent sessions can opt into.
- **Automations** — AI actions that run on triggers.
{{/ai}}- **Notifications** — opt into OS notifications (sent only when the window isn't
  focused) for PR activity, CI checks, reviews on your PRs, and workflow runs finishing.
- **Keyboard** — rebind any shortcut, with live key-capture.
- **Accounts** — your GitHub sign-in.
- **Git** — the default branch name for new repos, your global identity, a per-repository
  identity override, and line endings (\`core.autocrlf\`).
- **Syntax** — map file extensions to languages or add custom grammars, personally or
  shared with the repo via \`.gitdesktop/syntax.json\`.
- **External editor / Terminal** — auto-detected, or point at any executable. These power
  the "Open in…" actions throughout the app.
- **About** — app, OS, and component versions, a **health check** for your installed tools
  (Git, the GitHub / GitLab CLIs{{ai}}, and the Claude Code / Codex / Copilot / opencode
  agents{{/ai}}), and the current window position.

## Staying up to date

GitDesktop updates itself from GitHub Releases. On launch it checks for a newer version
(you can turn this off in **Settings → Updates**) and, when one exists, offers to
**install on your consent** — it never updates silently. Updates are cryptographically
signed and verified by the app. You can also check anytime with **Check for updates now**.`,
  },
];
