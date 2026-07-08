- **The merge dialog no longer offers to delete a branch it can't.** When merging a
  pull/merge request, the "Delete _branch_ on the remote after merging" option is now
  hidden when the head is the repository's **default branch** (which every forge refuses
  to delete) and disabled with a reason when a **branch rule** protects it — matching the
  branch switcher. Applies to GitHub, GitLab, and Bitbucket, including GitLab auto-merge.
