- **Automations redesigned around a lifecycle grid.** Automations (Settings → Automations,
  and per-repo from a repository's ⋯ menu) are now grouped by moment — *On commit*, *On pull
  request opened*, and *On new commits to a reviewed PR* — with AI code review and security
  audit as toggles under each, so duplicate or conflicting rules are no longer possible. Each
  enabled action can be scoped with **branch conditions** (include/exclude globs, plus a
  Source / Target / Either match for PR events) and a "Try a branch" preview. Both the global
  and per-repo surfaces now edit behind **Save / Discard** rather than saving on every toggle,
  and the per-repo dialog shows the effective settings, badges overridden cells, can enable an
  action that's globally off, and offers "Reset to global defaults". Your existing automations
  are migrated automatically on first launch, with any duplicate rules merged and noted once.
