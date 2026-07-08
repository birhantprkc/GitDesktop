- **Activity & notifications inbox.** The header activity control is now a persistent bell:
  alongside in-progress work (AI reviews, with Cancel) it keeps a **history of terminal
  events** — a finished review, checks passing/failing, a PR approved / changes-requested /
  commented / merged, a review requested from you, a completed CI run, or a finished agent,
  research, or plan run. Each entry click-navigates to its source, unread items carry a badge, and the
  list survives an app restart, so a review that finishes while you're away is never a
  missed click. Open it with the command palette (**Activity & notifications**), clear items
  or mark all read, and arrow-key through the list. Which events appear follows your
  **Settings → Notifications** choices. (New-comment / new-review / review-requested
  detection is GitHub-only for now.)
