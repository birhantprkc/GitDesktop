- **Syntax highlighting holds up in large files.** Diffs keep their syntax colors
  much further into big files — an edit deep in a long file (past ~2,000 lines) no
  longer silently drops all highlighting, and the size limit before a diff falls
  back to plain text is now tuned per highlighter (400 KB for highlight.js,
  150 KB for Shiki languages like Rust and TSX, up from a flat 100 KB).
