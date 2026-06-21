// The diff renderer (@git-diff-view/react) has no virtualization: it commits a
// DOM row for every line in one synchronous render, so a large file blocks the
// main thread on each file switch. Until/unless we virtualize, we cap how much
// of a big diff we hand it at once and offer a one-click "show full diff".

/** Past this many lines, a diff is capped to keep the render under ~1 frame. */
export const DIFF_LINE_CAP = 200;

interface CappedDiff {
  /** The (possibly shortened) unified-diff text to render. */
  text: string;
  /** Diff lines hidden by the cap; 0 when nothing was cut. */
  hidden: number;
}

/**
 * Cap a unified diff to at most `maxLines` lines so the un-virtualized renderer
 * doesn't mount thousands of rows at once. Cuts on hunk boundaries where it can;
 * a single oversized hunk is cut mid-body with its `@@` header counts rewritten
 * so the result stays a valid hunk the renderer can parse.
 */
export function capDiffText(text: string, maxLines: number): CappedDiff {
  // Count lines without allocating — most diffs fit under the cap and never need
  // the full split (which builds an array as large as the whole diff).
  let lineCount = 1;
  for (let k = 0; k < text.length; k++) {
    if (text.charCodeAt(k) === 10 /* \n */) lineCount++;
  }
  if (lineCount <= maxLines) return { text, hidden: 0 };
  const lines = text.split("\n");

  // Header = everything before the first hunk (diff --git, index, ---, +++).
  const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
  if (firstHunk === -1) {
    // No recognizable hunks — slice raw rather than guess.
    return {
      text: lines.slice(0, maxLines).join("\n"),
      hidden: lines.length - maxLines,
    };
  }

  let i = firstHunk;
  let kept = firstHunk; // header lines are always kept

  while (i < lines.length) {
    // This hunk runs from i (an `@@` line) to the next `@@` or EOF.
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith("@@")) j++;
    const hunkLen = j - i;

    if (kept + hunkLen <= maxLines) {
      kept += hunkLen;
      i = j;
      continue;
    }

    if (kept > firstHunk) {
      // Already kept at least one whole hunk — stop on this clean boundary.
      return { text: lines.slice(0, i).join("\n"), hidden: lines.length - i };
    }

    // The very first hunk overflows on its own — keep its header plus as much
    // body as fits, with the `@@` counts rewritten to match what we kept.
    const budget = Math.max(1, maxLines - kept - 1);
    const body = lines.slice(i + 1, i + 1 + budget);
    const cut = i + 1 + body.length;
    return {
      text: [
        ...lines.slice(0, i),
        rewriteHunkHeader(lines[i], body),
        ...body,
      ].join("\n"),
      hidden: lines.length - cut,
    };
  }

  return { text, hidden: 0 };
}

/** Rewrite a hunk header's line counts to match a truncated body. */
function rewriteHunkHeader(header: string, body: string[]): string {
  const m = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
  if (!m) return header;
  let oldCount = 0;
  let newCount = 0;
  for (const l of body) {
    const c = l[0];
    if (c === "+") newCount++;
    else if (c === "-") oldCount++;
    else if (c === "\\")
      continue; // "\ No newline at end of file" counts for neither
    else {
      oldCount++; // context line (leading space) belongs to both sides
      newCount++;
    }
  }
  return `@@ -${m[1]},${oldCount} +${m[2]},${newCount} @@${m[3]}`;
}
