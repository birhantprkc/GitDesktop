- Removing the **currently open** repository with **Also move this repository to the
  Recycle Bin** checked now closes it first, so the move no longer fails with a raw
  "Some operations were aborted" error. If the folder is still locked by another program,
  the message now explains that an open editor, terminal, or file-explorer window is
  likely holding it — and the repository stays listed so you can close them and retry.
