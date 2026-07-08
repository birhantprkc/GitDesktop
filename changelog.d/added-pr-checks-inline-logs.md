- **CI checks rollup with inline logs.** A pull request's checks now fold into a rollup
  summary — ✓ passed · ✕ failed · ● pending, each count with its own icon and word — that
  auto-expands whenever something failed and lists the checks failures-first. This now
  covers **GitHub PRs**, **GitLab MRs** (from the MR's pipeline jobs), and **Bitbucket PRs**
  (from the PR head commit's build statuses). A failing **GitHub Actions** or **GitLab
  pipeline** job peeks its job log inline, without leaving the PR, with an "Open full run"
  link; external checks and **Bitbucket** build statuses (which expose no fetchable logs)
  link straight out.
