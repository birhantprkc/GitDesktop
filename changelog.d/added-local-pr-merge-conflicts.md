- **Resolve local-PR merge conflicts without touching your working tree.** When a local
  pull-request merge hits conflicts, GitDesktop now runs the merge in an isolated,
  hidden worktree — your branch and working tree stay exactly as they were, so you never
  need a clean tree (unless you're merging into the branch you're currently on). The PR
  view opens a dedicated resolve surface with the conflicted files and the in-app conflict
  editor (per-region accept + AI resolution), then **Finish merge** (commit + mark the PR
  merged) or **Abort** (throw the merge away). The PR also pre-shows whether a merge will
  conflict before you start.
