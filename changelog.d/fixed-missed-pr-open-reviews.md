- Pull requests you open **outside** GitDesktop — with the `gh`/`glab` CLI, on the
  web, or via a bot — now get their initial automated AI review too. Previously the
  *On pull request opened* automation fired only for PRs created through the app's own
  dialog, so externally-opened PRs got no first pass. The poller now catches up your
  own non-draft, recently-opened, unreviewed PRs and runs the review automatically.
