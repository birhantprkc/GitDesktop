import { budgetDiff } from "./truncate";
import type {
  BranchNamePromptInput,
  CommitPromptInput,
  PrPromptInput,
  ReviewMode,
  ReviewPromptInput,
} from "./types";

const BASE_SYSTEM = `You write git commit messages.
Output ONLY the commit message itself: the first line is the subject (imperative mood, at most 72 characters), then a blank line, then an optional body explaining what changed and why.
Never reference issue or PR numbers, tickets, or links (e.g. "Closes #123") — you can't see the issue tracker, so any such reference is fabricated.
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

const BRANCH_SYSTEM = `You generate a single git branch name for a set of in-progress changes.
Output ONLY the branch name — one line, nothing else: no quotes, no explanation, no markdown, no trailing period.
Use lowercase kebab-case, 2-5 words, specific to what the change does (avoid generic names like "updates" or "changes").
If the existing branch names below show a prefix convention (e.g. "feature/", "fix/", "chore/"), follow it; otherwise pick a fitting type prefix such as "feature/" or "fix/".
Never use spaces, uppercase, or characters invalid in a git ref name.`;

export function buildBranchNamePrompt(input: BranchNamePromptInput): {
  system: string;
  prompt: string;
} {
  const systemParts = [BRANCH_SYSTEM];
  if (input.repoInstructions) {
    systemParts.push(`## Project instructions\n${input.repoInstructions}`);
  }
  if (input.globalInstructions.trim()) {
    systemParts.push(
      `## User instructions\n${input.globalInstructions.trim()}`,
    );
  }

  const tracked = input.files.map((f) =>
    f.isBinary ? `${f.path} (binary)` : `${f.path} +${f.added} -${f.deleted}`,
  );
  const untracked = input.untrackedPaths.map((p) => `${p} (new file)`);
  const fileSummary = [...tracked, ...untracked].join("\n");

  const budgeted = budgetDiff(stripBinarySections(input.diffText));

  let filesSection = `## Files changed\n${fileSummary || "(none)"}`;
  if (input.excludedFiles > 0) {
    filesSection += `\n[${input.excludedFiles} additional changed file(s) hidden by the user's AI ignore rules]`;
  }
  const promptParts = [filesSection];
  if (input.recentBranches.length > 0) {
    promptParts.push(
      `## Existing branch names (convention reference)\n${input.recentBranches.join("\n")}`,
    );
  }
  const diffBody =
    budgeted.text ||
    "(no text diff — name the branch from the file list above)";
  let diffSection = `## Changes diff\n${diffBody}`;
  if (budgeted.truncated || input.diffTruncated) {
    diffSection +=
      "\n[diff truncated — rely on the file summary above for full coverage.]";
  }
  promptParts.push(diffSection);
  promptParts.push("Generate the branch name for these changes.");

  return {
    system: systemParts.join("\n\n"),
    prompt: promptParts.join("\n\n"),
  };
}

const PR_SYSTEM = `You write GitHub pull request descriptions for reviewers.

First line: the PR title — concise, imperative mood, no trailing period, no "PR:"/"Title:" prefix.
Then a blank line, then the description in GitHub-flavored Markdown.

Structure the description like a strong human-written PR:
- Open with a 1-3 sentence summary that states what the change accomplishes AND why — the goal or motivation behind it — not just a restatement of the diff.
- Then cover the notable changes. If the diff spans several distinct areas or concerns, GROUP related changes under short \`###\` section headings (by feature, layer, or component, e.g. "### API layer", "### Documentation") with a few bullets under each. If the change is small or single-purpose, skip the headings and use one flat bulleted list.
- In every bullet, name the concrete file, directory, or symbol involved so a reviewer can find it — e.g. "Adds validation in \`src/contact.ts\`". This grounding is what makes the description trustworthy.
- Order from most to least significant. Be specific and factual; describe only what the diff shows. Do not invent changes, tests, motivations, or file names you cannot see.
- NEVER reference issue or PR numbers, tickets, milestones, or external links (e.g. "Closes #123", "part of #60", "fixes JIRA-4"). You have no access to the issue tracker, so any such reference is fabricated — leave them out entirely.

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
  promptParts.push(
    "Write the pull request title and description. Lead with a summary of the goal, then group related changes by theme under `###` headings when the diff touches several areas, citing the files involved.",
  );

  return {
    system: systemParts.join("\n\n"),
    prompt: promptParts.join("\n\n"),
  };
}

const GENERAL_REVIEW_SYSTEM = `You are a senior software engineer reviewing a pull request. Review ONLY the changes in the provided diff.

Write the review in GitHub-flavored Markdown:
- Start with a one or two sentence summary of what the change does and your overall assessment.
- Then list findings, grouped under \`###\` headings by theme when there are several (e.g. "### Correctness", "### Edge cases", "### Readability", "### Tests"). For each finding give a brief severity tag in bold (**blocker**, **should-fix**, or **nit**), name the file (and symbol/line context) it concerns, explain the problem, and suggest a concrete fix.
- Cover real issues: bugs, logic errors, unhandled edge cases or errors, security smells, performance traps, unclear naming, and missing or weak tests. Prefer a few high-value findings over an exhaustive list of nits.
- Be specific and grounded strictly in the diff — do not invent code, files, or behavior you cannot see. If the change looks solid, say so plainly and keep it short.

Do not wrap the whole review in a code fence. Do not restate the entire diff.`;

const SECURITY_REVIEW_SYSTEM = `You are an application security auditor performing a focused security review of a pull request. Examine ONLY the changes in the provided diff for vulnerabilities that the change introduces or exposes.

Look for real, exploitable issues such as: injection (SQL/command/LDAP/NoSQL), broken authentication or authorization, exposed secrets or credentials, insecure cryptography or weak randomness, SSRF, path traversal, unsafe deserialization, XSS / SSTI, insecure file or permission handling, missing input validation, and unsafe handling of untrusted data.

Output GitHub-flavored Markdown:
- If you find issues, list each as its own finding with: a bold **Severity: High/Medium/Low**, the location (file and the relevant code/area), a clear explanation of the vulnerability and how it could be exploited, and a concrete remediation.
- Order findings by severity, highest first.
- BE HIGH-SIGNAL: report only genuine, exploitable problems grounded in the diff. Do not pad with speculative, theoretical, or style issues, and do not invent code you cannot see. False positives are worse than brevity.
- If you find no security issues in these changes, say so explicitly in one line.

Do not wrap the whole review in a code fence.`;

export function buildReviewPrompt(
  input: ReviewPromptInput,
  mode: ReviewMode,
): { system: string; prompt: string } {
  const fileSummary = input.files
    .map((f) =>
      f.isBinary ? `${f.path} (binary)` : `${f.path} +${f.added} -${f.deleted}`,
    )
    .join("\n");

  const budgeted = budgetDiff(stripBinarySections(input.diffText));

  const promptParts: string[] = [];
  if (input.title.trim()) {
    promptParts.push(`# ${input.title.trim()}`);
  }
  if (input.body.trim()) {
    promptParts.push(`## Author's description\n${input.body.trim()}`);
  }
  if (input.commitSubjects.length > 0) {
    promptParts.push(
      `## Commits\n${input.commitSubjects.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  promptParts.push(`## Files changed\n${fileSummary || "(none)"}`);

  let diffSection = `## Diff\n${budgeted.text}`;
  if (budgeted.truncated || input.diffTruncated) {
    const omitted =
      budgeted.omittedFiles.length > 0
        ? ` ${budgeted.omittedFiles.length} file(s) omitted: ${budgeted.omittedFiles.join(", ")}.`
        : "";
    diffSection += `\n[diff truncated —${omitted} Review what is shown and note that coverage is partial.]`;
  }
  promptParts.push(diffSection);
  promptParts.push(
    mode === "security"
      ? "Perform the security review of these changes."
      : "Review these changes.",
  );

  return {
    system:
      mode === "security" ? SECURITY_REVIEW_SYSTEM : GENERAL_REVIEW_SYSTEM,
    prompt: promptParts.join("\n\n"),
  };
}

const DEBUG_SYSTEM = `You are an expert CI/CD engineer helping debug a failed GitHub Actions job. You are given the failing job's logs (the failed steps only, when available).

Diagnose the failure and explain how to fix it, in GitHub-flavored Markdown:
- Start with **Root cause** — one or two sentences naming what actually failed.
- Then **Fix** — concrete, actionable steps. Give exact commands, config, or code in fenced blocks where you can, and name the repo file when the fix lives in one.
- If useful, add **Why it happened** citing the key evidence line(s) from the logs.
- If the logs are truncated or don't contain enough to be sure, say what's missing and give your best hypothesis instead of guessing confidently.
- End with a \`## Agent prompt\` section whose body is a single fenced code block containing a self-contained instruction that a coding agent (e.g. Claude Code or Codex) running in this repository could follow to implement the fix. Write it as a direct task addressed to the agent, name the specific files to change, and include the essential context so it can act without seeing these logs. If you can't be confident in a fix, still give a prompt that tells the agent what to investigate.

Be concise and high-signal. Ground every claim in the logs — do not invent errors, files, or commands you cannot see. Do not wrap the whole answer in a single code fence.`;

export interface DebugPromptInput {
  workflowName: string;
  jobName: string;
  /** The job's conclusion (e.g. "failure", "timed_out"). */
  conclusion: string;
  /** Names of the steps that failed, when known. */
  failedSteps: string[];
  /** The job logs (already tail-capped by the backend). */
  logs: string;
}

export function buildDebugPrompt(input: DebugPromptInput): {
  system: string;
  prompt: string;
} {
  const parts: string[] = [
    `Workflow: ${input.workflowName}`,
    `Job: ${input.jobName}`,
    `Result: ${input.conclusion || "failure"}`,
  ];
  if (input.failedSteps.length > 0) {
    parts.push(
      `Failed steps:\n${input.failedSteps.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  parts.push(`## Logs\n\`\`\`\n${input.logs}\n\`\`\``);
  parts.push("Diagnose this failure and explain how to fix it.");
  return { system: DEBUG_SYSTEM, prompt: parts.join("\n\n") };
}

/**
 * Pulls the ready-to-paste agent prompt out of a debug response — the fenced
 * code block under the trailing `## Agent prompt` heading. Returns null until
 * that block has fully streamed in (so a "Copy fix prompt" affordance can wait
 * for it). Tolerant of the heading level and an optional code-fence language.
 */
export function extractAgentPrompt(text: string): string | null {
  const match = text.match(
    /^#{1,6}\s*Agent prompt\b[^\n]*\n+```[^\n]*\n([\s\S]*?)```/im,
  );
  const body = match?.[1]?.trim();
  return body ? body : null;
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

/** First non-empty line of a branch-name response, with wrapping quotes/fences
 *  stripped. Still pass the result through sanitizeRefName for git validity. */
export function extractBranchName(raw: string): string {
  const line =
    raw
      .replace(/```[a-z]*/gi, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  return line.replace(/^[`'"]+|[`'"]+$/g, "").trim();
}

const DESCRIPTION_SYSTEM = `You write a GitHub repository's "About" metadata from its README.
Output EXACTLY these two lines and nothing else:
Description: <one concise line, at most ~140 characters, no trailing period, no quotes; describe what the project does — do not begin with "This repository", "A repository for", or the project's own name>
Topics: <3 to 8 space-separated lowercase tags using only letters, digits, and hyphens, e.g. "react typescript cli git">`;

export function buildRepoDescriptionPrompt(input: {
  repoName: string;
  readme: string;
  repoInstructions: string | null;
  globalInstructions: string;
}): { system: string; prompt: string } {
  const systemParts = [DESCRIPTION_SYSTEM];
  if (input.repoInstructions) {
    systemParts.push(`## Project instructions\n${input.repoInstructions}`);
  }
  if (input.globalInstructions.trim()) {
    systemParts.push(
      `## User instructions\n${input.globalInstructions.trim()}`,
    );
  }

  const promptParts = [`## Repository name\n${input.repoName}`];
  if (input.readme.trim()) {
    promptParts.push(`## README (truncated)\n${input.readme.slice(0, 6000)}`);
  } else {
    promptParts.push(
      "## README\n(none — infer from the repository name alone)",
    );
  }
  promptParts.push("Write the description and topics.");
  return {
    system: systemParts.join("\n\n"),
    prompt: promptParts.join("\n\n"),
  };
}

/** Parse the model's "Description:" / "Topics:" lines into clean values. */
export function extractRepoDetails(raw: string): {
  description: string;
  topics: string[];
} {
  const lines = raw
    .replace(/```[a-z]*/gi, "")
    .replace(/```/g, "")
    .split("\n")
    .map((l) => l.trim());

  const descLine =
    lines.find((l) => /^description\s*[:-]/i.test(l)) ??
    lines.find((l) => l.length > 0) ??
    "";
  const description = descLine
    .replace(/^description\s*[:-]\s*/i, "")
    .replace(/^[`'"]+|[`'"]+$/g, "")
    .replace(/\.$/, "")
    .trim()
    .slice(0, 350);

  const topicsLine = lines.find((l) => /^topics\s*[:-]/i.test(l)) ?? "";
  const topics = topicsLine
    .replace(/^topics\s*[:-]\s*/i, "")
    .split(/[\s,]+/)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean)
    .slice(0, 20);

  return { description, topics: [...new Set(topics)] };
}

const ISSUE_DRAFT_SYSTEM = `You turn a user's rough notes into a clear, well-structured GitHub issue.
Output EXACTLY in this shape and nothing else:
Title: <one concise line summarizing the issue, no trailing period, no quotes>

<the issue body in GitHub-flavored markdown — organized with the sections appropriate to the notes (e.g. context/summary, steps to reproduce, expected vs. actual, proposed change), using headings and lists where they help>

Expand and clarify the user's notes, but do NOT invent specifics (version numbers, exact error text, file names, stack traces) that the notes don't imply — leave a placeholder or omit instead. Do not wrap the output in code fences.`;

export function buildIssueDraftPrompt(input: {
  notes: string;
  templates: string[];
  repoName: string;
  repoInstructions: string | null;
  globalInstructions: string;
}): { system: string; prompt: string } {
  const systemParts = [ISSUE_DRAFT_SYSTEM];
  if (input.templates.length > 0) {
    const templates = input.templates
      .map((t) => t.slice(0, 4000))
      .join("\n\n--- next template ---\n\n");
    systemParts.push(
      `## Repository issue template(s)\nThe repository provides the following issue template(s). Follow the structure and section headings of the one most relevant to the user's notes; drop template instructions/HTML comments and any checklist boilerplate that doesn't apply.\n\n${templates}`,
    );
  }
  if (input.repoInstructions) {
    systemParts.push(`## Project instructions\n${input.repoInstructions}`);
  }
  if (input.globalInstructions.trim()) {
    systemParts.push(
      `## User instructions\n${input.globalInstructions.trim()}`,
    );
  }

  const prompt = [
    `## Repository\n${input.repoName}`,
    `## The user's rough notes\n${input.notes.slice(0, 6000)}`,
    "Write the issue Title and body.",
  ].join("\n\n");

  return { system: systemParts.join("\n\n"), prompt };
}

/** Parse the model's "Title:" line + markdown body into a draft issue. */
export function extractIssueDraft(raw: string): {
  title: string;
  body: string;
} {
  const cleaned = raw
    .replace(/^\s*```[a-z]*\n?/i, "")
    .replace(/```\s*$/g, "")
    .trim();
  const lines = cleaned.split("\n");
  const titleIdx = lines.findIndex((l) => /^title\s*[:-]/i.test(l.trim()));
  if (titleIdx === -1) {
    return { title: "", body: cleaned };
  }
  const title = lines[titleIdx]
    .replace(/^\s*title\s*[:-]\s*/i, "")
    .replace(/^[`'"]+|[`'"]+$/g, "")
    .trim()
    .slice(0, 250);
  const body = lines
    .slice(titleIdx + 1)
    .join("\n")
    .trim();
  return { title, body };
}

const RELEASE_NOTES_SYSTEM = `You write polished GitHub release notes as GitHub-flavored markdown
only — no preamble, no title line, no code fences.

You are given either GitHub's auto-generated changelog (a "What's Changed" list of merged pull
requests, each line like "* Title by @author in <pr-url>") or, when that isn't available, a raw
list of commit subjects.

When given the pull-request changelog (preferred):
- Reorganize every entry under short, meaningful headings (e.g. ## Features, ## Fixes,
  ## Maintenance). Never drop, collapse away, or invent entries — every PR must appear once.
- PRESERVE each entry's author credit and pull-request link verbatim — keep the
  "by @author in <pr-url>" tail exactly. You may tidy the human-facing title (strip prefixes like
  "[Patch]"/"[Hotfix]", fix casing) but never remove the attribution or the link.
- If a "**Full Changelog**: <url>" line is present, keep it verbatim as the very last line.
- You may open with a brief "## Highlights" of one or two sentences naming the most notable changes.

When given only commit subjects:
- Group them under short headings with concise past-tense bullets. Merge trivial/duplicate commits
  and drop noise (merge commits, "wip", formatting-only, version bumps). Do NOT invent changes.

Keep it concise and scannable. If there are very few entries, a short flat list is fine.`;

export function buildReleaseNotesPrompt(input: {
  repoName: string;
  version: string;
  commits: string[];
  /** GitHub's auto-generated changelog (PR titles, authors, links). Preferred source. */
  changelog?: string;
  globalInstructions: string;
}): { system: string; prompt: string } {
  const systemParts = [RELEASE_NOTES_SYSTEM];
  if (input.globalInstructions.trim()) {
    systemParts.push(
      `## User instructions\n${input.globalInstructions.trim()}`,
    );
  }
  const source = input.changelog?.trim()
    ? `## GitHub changelog — reorganize and enrich this; keep every PR link and author credit\n${input.changelog.trim()}`
    : `## Commits in this release\n${input.commits.slice(0, 300).join("\n")}`;
  const prompt = [
    `## Repository\n${input.repoName}`,
    input.version ? `## Version\n${input.version}` : "",
    source,
    "Write the release notes.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: systemParts.join("\n\n"), prompt };
}
