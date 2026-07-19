- **Publishing a draft release no longer clears its Latest status.** Publishing
  a draft from the app now follows GitHub's default and becomes the **Latest**
  release on publish, instead of being forced non-latest. The Edit dialog explains
  that Latest applies only to published releases rather than offering a toggle
  GitHub would silently ignore on a draft. The MCP `update_release` tool had the
  same issue and is fixed too.
