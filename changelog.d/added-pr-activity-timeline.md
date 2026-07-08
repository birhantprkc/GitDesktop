- **PR activity feed.** A pull request's Conversation is now a single date-sorted activity
  feed that interleaves reviews, comments, pushed commits, and events — on **GitHub**,
  **GitLab MRs**, and **Bitbucket PRs** alike. A run of pushes collapses into a "pushed N
  commits" row that expands to the commits, and each commit's short SHA is clickable — it
  jumps to that commit's detail. GitHub shows the full event set (force-push, label
  add/remove, review request, ready-for-review, convert-to-draft, close, reopen, merge,
  rename); GitLab MRs add label add/remove, close/reopen/merge, and approval events
  (approved / changes-requested / approval-withdrawn), with no force-push or draft events;
  Bitbucket PRs add merge/close and approved / changes-requested, with no labels or
  review-requests. An approval or changes-request that predates a later push is flagged
  **stale · N commits since**.
