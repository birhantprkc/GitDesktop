/**
 * Splits a combined unified diff (e.g. `gh pr diff`) into per-file sections
 * keyed by the new-file path, so each can be fed to the file diff viewer.
 */
export function splitUnifiedDiff(diff: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const part of diff.split(/^(?=diff --git )/m)) {
    if (!part.trim()) continue;
    // Prefer the `+++ b/<path>` line (present for edits); fall back to the
    // `diff --git a/<p> b/<p>` header (covers pure renames/deletes).
    const plus = part.match(/^\+\+\+ b\/(.+)$/m);
    const header = part.match(/^diff --git a\/.+ b\/(.+)$/m);
    const path = plus?.[1] ?? header?.[1];
    if (path) sections.set(path.trim(), part);
  }
  return sections;
}
