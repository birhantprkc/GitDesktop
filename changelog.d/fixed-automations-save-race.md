- Concurrent automation-settings saves no longer overwrite each other — the
  global defaults and a repository's overrides are each re-derived from fresh
  state when saved, so two overlapping saves can't drop one another's change.
