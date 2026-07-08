- **AI review factors in its own prior comments.** When you re-review a pull request, the AI
  review now reads the comments GitDesktop has already posted on it — past reviews and any
  agent follow-ups (a refutation, or a "fixed in `<sha>`" reply) — and treats a finding it
  already resolved or refuted as settled instead of raising it cold again, unless the current
  diff still shows the problem. Works on GitHub PRs and GitLab MRs (remote PRs only).
