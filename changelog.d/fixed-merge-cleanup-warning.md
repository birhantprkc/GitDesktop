- Merging a GitHub pull request that deletes its head branch no longer shows a red
  failure toast when only the post-merge branch cleanup fails: the merge already
  succeeded, so it now reports success and surfaces the cleanup problem as a
  separate warning instead of masquerading as a failed merge.
