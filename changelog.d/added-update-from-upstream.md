- **Update a fork from its upstream.** When a repo has an `upstream` remote, the Pull menu
  (and the command palette) gain **Update from upstream**: it fetches upstream, resolves its
  default branch, and brings your current branch up to date — fast-forwarding silently when it
  can, creating a merge commit when the histories have cleanly diverged, and routing conflicts
  to the usual conflict editor. It never pushes for you; the Push button lights up on its own
  once you're ahead.
