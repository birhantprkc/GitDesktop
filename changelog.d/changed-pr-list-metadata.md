- **Pull request rows now show when each PR was opened**, matching the issue list —
  `#12 · author · 3 hours ago · head → base`. Local pull request rows show their age
  too. Each row also gains a small CI indicator a moment after the list loads — on
  GitHub and GitLab, and on Bitbucket wherever a PR reports build statuses: a check for
  passing, a cross for failing, and a clock for checks still running (rows with no
  checks show none). Each icon has a distinct shape and a hover label, so the signal
  never relies on color alone.
