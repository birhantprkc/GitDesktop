/**
 * Pure helpers behind the review-composition layer: extracting the current
 * new-side content of a selected line range from a file's unified-diff section,
 * building the provider-correct ```suggestion fence pre-filled with that code,
 * and synthesizing a GitHub-shaped `diffHunk` fragment for a GitLab/Bitbucket
 * thread (whose API returns no hunk) so the Apply affordance can light up.
 *
 * No React here — these are unit-test-quality functions consumed by
 * ReviewComposer.tsx and ReviewThreads.tsx. The hunk-parsing mirrors
 * ReviewThreads.tsx's `parseHunk`/`newSideLines` (its twin); they are kept as
 * separate local copies deliberately (that file's versions are private to it and
 * coupled to its `HunkLine`/`ReviewThreadOut` shapes) — any change to the unified
 * marker/counter rules must be mirrored in BOTH. See the comment on
 * {@link parseSectionLines}.
 */

/** One parsed new-side line of a unified-diff section: its 1-based new-side line
 *  number (null for removed lines, which carry no new-side number) and the raw
 *  text including the leading +/-/space marker. */
interface SectionLine {
  number: number | null;
  kind: "add" | "del" | "context";
  /** Raw line including its leading marker (+, -, or space). */
  text: string;
}

/**
 * Parse every hunk of a per-file unified-diff section into new-side-numbered
 * lines. The section is the text produced for ONE file (one or more `@@` hunks,
 * with the leading `diff --git`/`---`/`+++` header lines, if any, ignored).
 *
 * New-side numbering advances on context + added lines and resets at each hunk
 * header's `+c` start; removed lines carry no new-side number. This mirrors
 * ReviewThreads.tsx's private `parseHunk` counter rules (the `\ No newline`
 * annotation is skipped and does NOT advance the counter) so a hunk synthesized
 * from this parse lines up with that file's Apply gating.
 */
function parseSectionLines(section: string): SectionLine[] {
  const out: SectionLine[] = [];
  let newNo: number | null = null;
  for (const raw of section.split("\n")) {
    const header = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      newNo = Number(header[1]);
      continue;
    }
    // Skip everything before the first hunk header (file header lines).
    if (newNo === null) continue;
    const marker = raw[0];
    // `\ No newline at end of file` annotates the previous line — not content,
    // so it gets no number and must not advance the counter.
    if (marker === "\\") continue;
    if (marker === "+") {
      out.push({ number: newNo, kind: "add", text: raw });
      newNo += 1;
    } else if (marker === "-") {
      out.push({ number: null, kind: "del", text: raw });
    } else {
      // Context line (leading space) or a stray blank; both advance new-side.
      out.push({ number: newNo, kind: "context", text: raw });
      newNo += 1;
    }
  }
  return out;
}

/**
 * The current new-side content of new-side lines `[from, to]` (inclusive,
 * 1-based) of a per-file unified-diff `section`, with the leading +/space marker
 * stripped — the lines a suggestion would replace. Returns null when the range
 * isn't fully covered by the section (a gap, or `from > to`) so the caller can
 * degrade instead of prefilling a partial suggestion.
 *
 * Removed (`-`) lines carry no new-side number and are skipped; only added +
 * context lines have new-side numbers.
 */
export function extractNewSideLines(
  fileSection: string,
  from: number,
  to: number,
): string[] | null {
  if (from <= 0 || to < from) return null;
  const parsed = parseSectionLines(fileSection);
  const byNumber = new Map<number, SectionLine>();
  for (const ln of parsed) if (ln.number !== null) byNumber.set(ln.number, ln);
  const picked: string[] = [];
  for (let n = from; n <= to; n += 1) {
    const hit = byNumber.get(n);
    if (!hit) return null; // gap — range not fully in the section
    picked.push(hit.text.slice(1)); // strip the single leading marker
  }
  return picked;
}

/**
 * Build the opening line of the provider-correct ```suggestion fence,
 * pre-filled with `currentLines` as its body, for a selected new-side range.
 *
 * - **GitHub**: a plain ```suggestion fence. The multi-line range is carried by
 *   the thread's `startLine`/`line` anchor, not the fence, so the header is bare.
 * - **GitLab**: the fence anchors at the END line; a multi-line replacement is
 *   expressed as ```suggestion:-N+0 where `N = to - from` lines above the anchor
 *   (0 ⇒ a bare ```suggestion for a single line).
 * - **Bitbucket**: single-line only — a bare ```suggestion. The caller must not
 *   offer the action for a multi-line range (Bitbucket suggestions replace one
 *   line); this still emits a valid single-line fence when misused.
 *
 * Returns the full fenced block: the opener, the current lines, and the closing
 * ``` — ready to splice into a comment body.
 */
export function buildSuggestionFence(
  provider: "github" | "gitlab" | "bitbucket",
  selected: { from: number; to: number },
  currentLines: string[],
): string {
  const span = Math.max(0, selected.to - selected.from);
  const opener =
    provider === "gitlab" && span > 0
      ? `\`\`\`suggestion:-${span}+0`
      : "```suggestion";
  return [opener, ...currentLines, "```"].join("\n");
}

/**
 * Synthesize a GitHub-shaped `diffHunk` fragment for a thread whose provider
 * (GitLab/Bitbucket) returns no hunk, so ReviewThreads' HunkExcerpt +
 * `recoverOriginals` can render and gate Apply exactly as they do for GitHub.
 *
 * The output is a `@@ -a,b +c,d @@`-headed fragment whose new-side numbering
 * reaches the thread's anchor `line`, carrying the real +/-/context markers of
 * the covered lines from `fileSection`. It ends at `line` (the anchored tail,
 * like GitHub's diffHunk). The old-side counts are best-effort but well-formed;
 * `parseHunk`/`recoverOriginals` only read the new-side `+c` start + markers.
 *
 * Returns null when the section doesn't cover the thread's range
 * `[startLine>0 ? startLine : line, line]` (so the caller keeps the degraded,
 * no-Apply render rather than a half-hunk).
 */
export function synthesizeThreadHunk(
  fileSection: string,
  thread: { line: number; startLine: number },
): string | null {
  const anchor = thread.line;
  if (anchor <= 0) return null;
  const from = thread.startLine > 0 ? thread.startLine : anchor;
  if (from <= 0 || from > anchor) return null;

  const parsed = parseSectionLines(fileSection);
  if (parsed.length === 0) return null;

  // The window is every parsed line from the first one numbered `from` through
  // the one numbered `anchor` (inclusive), preserving interleaved removed lines.
  const startIdx = parsed.findIndex((l) => l.number === from);
  const endIdx = parsed.findIndex((l) => l.number === anchor);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
  const window = parsed.slice(startIdx, endIdx + 1);

  // Every new-side number in [from, anchor] must be present (no gap) — otherwise
  // recoverOriginals would refuse it anyway; bail so we don't emit a half-hunk.
  const covered = new Set<number>();
  for (const l of window) if (l.number !== null) covered.add(l.number);
  for (let n = from; n <= anchor; n += 1) if (!covered.has(n)) return null;

  const newCount = window.filter((l) => l.kind !== "del").length;
  const oldCount = window.filter((l) => l.kind !== "add").length;
  const header = `@@ -${from},${oldCount} +${from},${newCount} @@`;
  return [header, ...window.map((l) => l.text)].join("\n");
}
