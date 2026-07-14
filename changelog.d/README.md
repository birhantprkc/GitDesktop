# Changelog fragments

Instead of editing `## [Unreleased]` in [`../CHANGELOG.md`](../CHANGELOG.md)
directly — where every branch collides — each user-facing change adds its **own
file** here. One file per change means parallel branches never conflict on the
changelog. At release time `pnpm release:prepare <version>` assembles these
fragments into `CHANGELOG.md`, in your exact
[Keep a Changelog](https://keepachangelog.com/) format, and deletes them.

## Format

Create a file named **`<category>-<slug>.md`**, where:

- `<category>` is one of `added`, `changed`, or `fixed` (the Keep a Changelog
  groups this project uses — `feat` → `added`, `fix` → `fixed`, refactors/perf →
  `changed`).
- `<slug>` is a short kebab-case topic. Keep it distinctive; append the PR number
  if you want to be certain it's unique (e.g. `added-gitlab-time-tracking-1234.md`).

The **file body is the finished changelog bullet, verbatim** — including the
leading `- ` and the 2-space indent on wrapped continuation lines. Write it *for
humans*: a clear sentence about what changed for the user, not your commit
subject. The assembler concatenates bodies under the right `###` heading without
re-wrapping, so what you write is exactly what ships.

### Example — `added-gitlab-time-tracking.md`

```md
- **GitLab time tracking.** Track time on a GitLab issue or merge request without
  leaving the app: set an **estimate** (e.g. `3h`) and log **spent** time (e.g.
  `45m`, or subtract with `-15m`), with a progress bar and an "over" note when
  spent exceeds the estimate.
```

### Example — `fixed-diff-error-boundary.md`

```md
- Diff-renderer exceptions are caught by an error boundary instead of taking
  down the whole app.
```

## Commands

- `pnpm changelog:preview` — show the pending fragments assembled under an
  Unreleased heading (nothing is written).
- `pnpm changelog` — draft starting-point bullets from the git history since the
  last tag (curate before saving as a fragment).
- `pnpm release` — (maintainers) interactive release driver: picks the bump, previews fragments, runs `release:prepare`, syncs `Cargo.lock`, then commits, tags, and pushes (the tag pushed explicitly).
- `pnpm release:prepare <version>` — (maintainers) assemble fragments into
  `CHANGELOG.md` as `## [<version>] - <date>`, bump `package.json` +
  `src-tauri/Cargo.toml`, and delete the consumed fragments.

`README.md` in this directory is ignored by the tooling and never consumed.
