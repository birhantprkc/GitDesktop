import { budgetDiff } from "./truncate";
import type { CommitPromptInput, PrPromptInput } from "./types";

const BASE_SYSTEM = `You write git commit messages.
Output ONLY the commit message itself: the first line is the subject (imperative mood, at most 72 characters), then a blank line, then an optional body explaining what changed and why.
Do not wrap the message in markdown fences. Do not add commentary before or after the message.`;

export function buildCommitPrompt(input: CommitPromptInput): {
  system: string;
  prompt: string;
} {
  const systemParts = [BASE_SYSTEM];
  if (input.repoInstructions) {
    systemParts.push(`## Project instructions\n${input.repoInstructions}`);
  }
  if (input.globalInstructions.trim()) {
    systemParts.push(
      `## User instructions\n${input.globalInstructions.trim()}`,
    );
  }

  const fileSummary = input.files
    .map((f) =>
      f.isBinary ? `${f.path} (binary)` : `${f.path} +${f.added} -${f.deleted}`,
    )
    .join("\n");

  const budgeted = budgetDiff(stripBinarySections(input.diffText));

  let filesSection = `## Files changed\n${fileSummary || "(none)"}`;
  if (input.excludedFiles > 0) {
    filesSection += `\n[${input.excludedFiles} additional changed file(s) hidden by the user's AI ignore rules — do not speculate about them]`;
  }
  const promptParts = [filesSection];
  if (input.recentSubjects.length > 0) {
    promptParts.push(
      `## Recent commit subjects (style reference)\n${input.recentSubjects.join("\n")}`,
    );
  }
  let diffSection = `## Staged diff\n${budgeted.text}`;
  if (budgeted.truncated || input.diffTruncated) {
    const omitted =
      budgeted.omittedFiles.length > 0
        ? ` ${budgeted.omittedFiles.length} file(s) omitted: ${budgeted.omittedFiles.join(", ")}.`
        : "";
    diffSection += `\n[diff truncated —${omitted} Rely on the file summary above for full coverage.]`;
  }
  promptParts.push(diffSection);
  promptParts.push("Write the commit message for these staged changes.");

  return {
    system: systemParts.join("\n\n"),
    prompt: promptParts.join("\n\n"),
  };
}

const PR_SYSTEM = `You write GitHub pull request descriptions.
Output the PR title on the first line: concise, imperative mood, no trailing period and no "PR:"/"Title:" prefix. Then a blank line, then the description body in GitHub-flavored Markdown: a short summary of what the change does and why, followed by a bulleted list of the notable changes. Keep it factual and grounded in the diff.
Do not wrap the output in code fences. Do not add commentary before the title or after the body.`;

export function buildPrPrompt(input: PrPromptInput): {
  system: string;
  prompt: string;
} {
  const systemParts = [PR_SYSTEM];
  if (input.repoInstructions) {
    systemParts.push(`## Project instructions\n${input.repoInstructions}`);
  }
  if (input.globalInstructions.trim()) {
    systemParts.push(
      `## User instructions\n${input.globalInstructions.trim()}`,
    );
  }

  const fileSummary = input.files
    .map((f) =>
      f.isBinary ? `${f.path} (binary)` : `${f.path} +${f.added} -${f.deleted}`,
    )
    .join("\n");

  const budgeted = budgetDiff(stripBinarySections(input.diffText));

  const promptParts = [
    `This pull request merges \`${input.headBranch}\` into \`${input.baseBranch}\`.`,
  ];
  if (input.commitSubjects.length > 0) {
    promptParts.push(
      `## Commits in this PR\n${input.commitSubjects.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  promptParts.push(`## Files changed\n${fileSummary || "(none)"}`);

  let diffSection = `## Combined diff\n${budgeted.text}`;
  if (budgeted.truncated || input.diffTruncated) {
    const omitted =
      budgeted.omittedFiles.length > 0
        ? ` ${budgeted.omittedFiles.length} file(s) omitted: ${budgeted.omittedFiles.join(", ")}.`
        : "";
    diffSection += `\n[diff truncated —${omitted} Rely on the commit list and file summary above for full coverage.]`;
  }
  promptParts.push(diffSection);
  promptParts.push("Write the pull request title and description.");

  return {
    system: systemParts.join("\n\n"),
    prompt: promptParts.join("\n\n"),
  };
}

/** Binary file contents never help the model; drop those sections entirely. */
function stripBinarySections(diffText: string): string {
  return diffText
    .split(/^(?=diff --git )/m)
    .filter((section) => !section.includes("\nBinary files "))
    .join("");
}

/**
 * Splits a (possibly still streaming) model response into commit title/body.
 * Tolerates a leading code fence the instructions told the model not to add.
 */
export function splitCommitMessage(raw: string): {
  title: string;
  body: string;
} {
  let text = raw.replace(/^\s*```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "");
  text = text.trimStart();
  const newline = text.indexOf("\n");
  if (newline === -1) {
    return { title: text.trimEnd(), body: "" };
  }
  const title = text.slice(0, newline).trimEnd();
  const body = text
    .slice(newline + 1)
    .replace(/^\n+/, "")
    .trimEnd();
  return { title, body };
}
