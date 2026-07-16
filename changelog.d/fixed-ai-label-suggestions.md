- **Fixed over-eager AI label suggestions in generated PR descriptions.** The AI
  PR-description generator now weighs each label's stated purpose (its description),
  not just its name, and follows a conservative policy: for most changes the right
  outcome is one label or none. It no longer pushes rare process labels — changelog
  or release controls, triage states, and dependency-bot ecosystem labels (a
  language or tooling name a bot applies to dependency bumps) — onto ordinary code
  changes, suggesting them only when the change is precisely that case.
