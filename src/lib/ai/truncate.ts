/** Character budget for the staged diff inside the AI prompt. */
export const DIFF_CHAR_BUDGET = 80_000;
/** Cap applied to each individual file section once over budget. */
const PER_FILE_CAP = 6_000;

const LOW_VALUE_PATH =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|bun\.lockb?|composer\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.(map|snap)$/;

interface FileSection {
  path: string;
  text: string;
}

export interface BudgetedDiff {
  text: string;
  truncated: boolean;
  omittedFiles: string[];
}

function splitIntoFileSections(diffText: string): FileSection[] {
  const sections: FileSection[] = [];
  const parts = diffText.split(/^(?=diff --git )/m).filter((p) => p.trim());
  for (const part of parts) {
    const header = part.slice(0, part.indexOf("\n"));
    // `diff --git a/<path> b/<path>` — take the b/ side
    const match = header.match(/ b\/(.+)$/);
    sections.push({ path: match?.[1] ?? header, text: part });
  }
  return sections;
}

/**
 * Fits a staged diff into the prompt budget: drop lockfile/generated diffs
 * first, then cap oversized per-file sections, then hard-cap the total.
 */
export function budgetDiff(
  diffText: string,
  budget: number = DIFF_CHAR_BUDGET,
): BudgetedDiff {
  if (diffText.length <= budget) {
    return { text: diffText, truncated: false, omittedFiles: [] };
  }

  const sections = splitIntoFileSections(diffText);
  const omittedFiles: string[] = [];

  let kept = sections.filter((s) => {
    if (LOW_VALUE_PATH.test(s.path)) {
      omittedFiles.push(s.path);
      return false;
    }
    return true;
  });

  let total = kept.reduce((sum, s) => sum + s.text.length, 0);
  if (total > budget) {
    kept = kept.map((s) =>
      s.text.length > PER_FILE_CAP
        ? {
            ...s,
            text: `${s.text.slice(0, PER_FILE_CAP)}\n[... rest of ${s.path} truncated]\n`,
          }
        : s,
    );
    total = kept.reduce((sum, s) => sum + s.text.length, 0);
  }

  const included: FileSection[] = [];
  let used = 0;
  for (const section of kept) {
    if (used + section.text.length > budget) {
      omittedFiles.push(section.path);
      continue;
    }
    included.push(section);
    used += section.text.length;
  }

  return {
    text: included.map((s) => s.text).join(""),
    truncated: true,
    omittedFiles,
  };
}
