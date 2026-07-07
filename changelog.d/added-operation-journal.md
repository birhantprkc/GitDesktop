- **Operation journal & interrupted-op recovery.** GitDesktop now records the risky
  compound operations it runs — local PR merges, cherry-picks, history edits, and
  interactive rebases — each with the exact branch and commit it started from. If one is
  interrupted by a crash or restart, a calm recovery notice appears above the **Changes**
  list naming what was interrupted and the state it began from; it only informs (the
  git-native Continue/Abort stay in the conflict bar). Browse the full log any time via the
  **Operation history** command or the branch ⋮ menu.
