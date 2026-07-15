- Merging a pull request in the app now kicks off a background fetch (with
  prune) right after the merge succeeds, so branches, ahead/behind counts, and
  history reflect the merge immediately instead of staying stale until you
  click Fetch. On a merge that deletes the head branch, the prune also drops
  the now-stale remote-tracking ref.
