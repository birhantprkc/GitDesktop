// Shared helpers for the changelog-fragment workflow. Fragments live in
// `changelog.d/` as `<added|changed|fixed>-<slug>.md` files whose body is the
// finished Keep a Changelog bullet; `changelog-release.mjs` assembles them into
// CHANGELOG.md and `changelog-draft.mjs --preview` previews them. Node built-ins
// only (no deps). The repo stores CHANGELOG.md as LF, so read/write via the LF
// helpers here — never let CRLF leak into a write.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The Keep a Changelog groups we use, in the order they render.
export const CATEGORY_ORDER = ["Added", "Changed", "Fixed"];

// A fragment file: `<category>-<slug>.md`. README.md / .gitkeep don't match, so
// they're never consumed. Case-insensitive so `Added-foo.md` still parses.
export const FRAGMENT_RE = /^(added|changed|fixed)-.+\.md$/i;

const emptyGroups = () =>
  Object.fromEntries(CATEGORY_ORDER.map((c) => [c, []]));

const toLF = (text) => text.replace(/\r\n/g, "\n");

/** Read a file and normalise its line endings to LF. */
export function readLF(path) {
  return toLF(readFileSync(path, "utf8"));
}

/** Write a file as LF, whatever the input used. */
export function writeLF(path, text) {
  writeFileSync(path, toLF(text), "utf8");
}

const categoryTitle = (lc) =>
  lc.charAt(0).toUpperCase() + lc.slice(1).toLowerCase();

/**
 * Read every fragment in `dir`, grouped by category. Filenames are sorted with
 * localeCompare so output is deterministic regardless of FS enumeration order.
 * Throws (naming the file) on a malformed fragment. Returns
 * `{ files: string[], groups: { Added, Changed, Fixed } }`; `files` are the
 * absolute paths that were consumed (for deletion by the release script).
 */
export function readFragments(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { files: [], groups: emptyGroups() };
  }
  const groups = emptyGroups();
  const files = [];
  for (const name of names
    .filter((n) => FRAGMENT_RE.test(n))
    .sort((a, b) => a.localeCompare(b))) {
    const path = join(dir, name);
    const category = categoryTitle(name.match(FRAGMENT_RE)[1]);
    const body = readLF(path).replace(/\n+$/, "");
    if (!body.startsWith("- ")) {
      throw new Error(
        `Fragment ${name} must start with "- " (a finished Markdown bullet). Got: ${JSON.stringify(
          body.slice(0, 60),
        )}`,
      );
    }
    groups[category].push(body);
    files.push(path);
  }
  return { files, groups };
}

// Split a fragment body into its bullets, each flattened to a single line: a
// "- " line opens a bullet, "  "-indented lines continue it, blanks are skipped.
const bulletsOf = (lines) => {
  const bullets = [];
  for (const line of lines) {
    if (line.startsWith("- ")) bullets.push([line.slice(2).trim()]);
    else if (line.trim() === "") continue;
    else if (line.startsWith("  ") && bullets.length > 0)
      bullets[bullets.length - 1].push(line.trim());
  }
  return bullets.map((parts) => parts.join(" "));
};

// Quoted UI copy is the app's own wording and legitimately carries em-dashes,
// so code, bold, and double-quoted spans come out before the count.
const withoutQuotedSpans = (text) =>
  text
    .replace(/`[^`]*`/g, "")
    .replace(/\*\*[^*]+\*\*/g, "")
    .replace(/"[^"]*"/g, "");

/**
 * Validate every changelog.d entry without assembling. Returns a list of
 * `{ file, problem }` — empty when everything is consumable. Unlike
 * readFragments (which throws on the FIRST bad body, at assembly time), this
 * collects every problem so CI and the release driver can report them all at
 * once — and it also catches the one failure readFragments can never see: a
 * misnamed `.md` file that FRAGMENT_RE doesn't match (e.g. `add-foo.md`),
 * which the assembler would silently ignore forever.
 */
export function validateFragments(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const problems = [];
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (name === "README.md" || !name.endsWith(".md")) continue;
    if (!FRAGMENT_RE.test(name)) {
      problems.push({
        file: name,
        problem:
          "filename will never be picked up by the assembler — name it <added|changed|fixed>-<slug>.md",
      });
      continue;
    }
    const body = readLF(join(dir, name)).replace(/\n+$/, "");
    if (!body.trim()) {
      problems.push({ file: name, problem: "fragment is empty" });
      continue;
    }
    if (!body.startsWith("- ")) {
      problems.push({
        file: name,
        problem: `must start with "- " (a finished Markdown bullet). Got: ${JSON.stringify(
          body.slice(0, 60),
        )}`,
      });
      continue;
    }
    const lines = body.split("\n");
    const problemsBefore = problems.length;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === "" || line.startsWith("- ") || line.startsWith("  ")) continue;
      problems.push({
        file: name,
        problem: `line ${i + 1} is a wrapped continuation but isn't indented 2 spaces (the assembler concatenates verbatim): ${JSON.stringify(
          line.slice(0, 40),
        )}`,
      });
      break;
    }
    if (problems.length > problemsBefore) continue;
    const interrupter = bulletsOf(lines).some(
      (bullet) => (withoutQuotedSpans(bullet).match(/—/g) || []).length >= 2,
    );
    if (interrupter) {
      problems.push({
        file: name,
        problem: `two or more em-dashes in one bullet reads as a paired "— aside —" interrupter — recast with commas or parentheses; quoted UI copy is exempt inside backticks, **bold**, or "quotes" (see CLAUDE.md "Reader-facing prose outside the blog")`,
      });
    }
  }
  return problems;
}

/**
 * Render the `### Category` blocks for the non-empty groups (no version heading),
 * as an array of lines. Each block is `### Cat`, blank, its bullets, blank.
 */
export function renderGroupBlocks(groups) {
  const out = [];
  for (const cat of CATEGORY_ORDER) {
    const items = groups[cat];
    if (!items || items.length === 0) continue;
    out.push(`### ${cat}`, "");
    for (const item of items) out.push(...item.split("\n"));
    out.push("");
  }
  return out;
}

/** Render a whole section (`## [heading]` + its category blocks) as lines. */
export function renderSectionLines(heading, groups) {
  return [heading, "", ...renderGroupBlocks(groups)];
}

/** Total bullet count across all groups. */
export function countEntries(groups) {
  return CATEGORY_ORDER.reduce((n, c) => n + groups[c].length, 0);
}
