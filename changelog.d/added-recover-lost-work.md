- **Recover lost work — restore orphaned stashes without the CLI.** A new **Recover lost
  work…** action (in the branch ⋮ menu and the command palette) opens a **Recoverable** tab
  in the stashes dialog that scans your repository with `git fsck` for orphaned/dangling
  stashes — uncommitted work a `git stash` saved but that has since fallen out of `git stash
  list` (dropped, or abandoned by an interrupted operation). Preview each one's files and
  diff, then **Restore to working tree** re-applies it non-destructively (it applies the
  stash, never dropping or committing), so you can recover work you thought was gone.
