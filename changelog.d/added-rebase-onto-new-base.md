- **Rebase a branch onto a different base.** A new **Change base…** action in the
  branch switcher (and command palette) fixes the "I branched off the wrong branch"
  case: pick the branch you meant to base on plus the one you actually based on, and
  GitDesktop replays only your branch's own commits onto the new base — leaving the
  wrong base's commits behind. A moving-commits preview shows exactly what will move
  before you run it, guards against a dirty tree, warns when the branch is already
  pushed, and routes any conflicts into the usual resolve flow.
