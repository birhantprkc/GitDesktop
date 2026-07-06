- **Update a branch from its own upstream without switching to it.** When a branch is
  behind the remote it tracks, its right-click menu in the branch switcher now offers
  **Update from origin/…** — fast-forwarding it (or merging in place if it's the current
  branch) without leaving the branch you're on. Made for the "just merged a PR, bring the
  default branch current before I switch back" flow: the default branch's row shows how far
  behind its upstream it is after a fetch, and *Update default branch from its remote* is
  available from the command palette.
