/**
 * Splitting a unified diff into hunks so each one can be staged, unstaged,
 * or discarded on its own via `git apply` (see git_apply_patch).
 */

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@ …` line. */
  header: string;
  /** The hunk including its header line, ending with a newline. */
  text: string;
}

export interface ParsedDiff {
  /** Everything before the first hunk (diff --git / index / --- / +++). */
  fileHeader: string;
  hunks: DiffHunk[];
}

/** Parses single-file unified diff text. Returns no hunks for binary diffs. */
export function parseHunks(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");
  const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
  if (firstHunk === -1) return { fileHeader: diffText, hunks: [] };

  const fileHeader = `${lines.slice(0, firstHunk).join("\n")}\n`;
  const hunks: DiffHunk[] = [];
  let start = firstHunk;
  for (let i = firstHunk + 1; i <= lines.length; i++) {
    if (i === lines.length || lines[i].startsWith("@@")) {
      const body = lines.slice(start, i).join("\n");
      // The split leaves a trailing empty string from the final newline —
      // joining can yield a trailing "\n" already; normalize to exactly one.
      hunks.push({
        header: lines[start],
        text: `${body.replace(/\n+$/, "")}\n`,
      });
      start = i;
    }
  }
  return { fileHeader, hunks };
}

/** A patch containing just one hunk, in the form `git apply` expects. */
export function buildHunkPatch(parsed: ParsedDiff, hunk: DiffHunk): string {
  return `${parsed.fileHeader}${hunk.text}`;
}
