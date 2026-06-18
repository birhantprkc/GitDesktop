import type { CustomLanguage } from "@/lib/settings/api";

/**
 * Best-effort import of VSCode language assets into our minimal grammar.
 *
 * - `language-configuration.json` (editor behaviour) → comments + string
 *   delimiters (it has no keywords).
 * - `*.tmLanguage.json` (a TextMate grammar) → keywords, comments, strings,
 *   extracted from the relevant scoped patterns.
 *
 * highlight.js can't run a TextMate grammar directly, so this is a lossy
 * extraction, not full-fidelity highlighting — see docs for the planned Shiki
 * engine. Returns only the fields it could fill.
 */
export type ImportedGrammar = Partial<
  Pick<
    CustomLanguage,
    | "keywords"
    | "lineComment"
    | "blockCommentStart"
    | "blockCommentEnd"
    | "stringDelimiters"
  >
>;

export interface ImportResult {
  kind: "tmLanguage" | "languageConfiguration";
  fields: ImportedGrammar;
}

interface TmPattern {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: TmPattern[];
  repository?: Record<string, TmPattern>;
}
interface TmGrammar extends TmPattern {
  scopeName?: string;
}
type Pair = string[] | { open?: string; close?: string };
interface LangConfig {
  comments?: { lineComment?: string; blockComment?: [string, string] };
  autoClosingPairs?: Pair[];
  surroundingPairs?: Pair[];
}

/** Tolerant JSON parse: strips // and /* *​/ comments and trailing commas while
 *  respecting string literals (VSCode config files are JSONC). */
function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  let inStr = false;
  let quote = "";
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) inStr = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
        i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Drop the escaping backslashes from a simple regex literal ("/\\*" → "/*"). */
function unescapeRe(re: string): string {
  return re.replace(/\\(.)/g, "$1");
}

/** The literal lead of a line-comment regex ("//.*$" → "//", "#[^\\n]*" → "#"). */
function literalPrefix(re: string): string {
  let s = re.replace(/^\^\s*/, "");
  const cut = s.search(/\.\*|\.\+|\[\^|\(\?:|\\s|\$/);
  if (cut > 0) s = s.slice(0, cut);
  return unescapeRe(s).trim();
}

/** Pull bareword alternatives out of a keyword match like "\\b(if|else)\\b". */
function extractKeywords(re: string): string[] {
  const cleaned = re.replace(/\\[a-zA-Z]/g, " ");
  const words = cleaned.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return words.filter((w) => w.length > 1);
}

function walk(node: TmPattern, visit: (n: TmPattern) => void): void {
  if (!node || typeof node !== "object") return;
  visit(node);
  if (Array.isArray(node.patterns))
    for (const p of node.patterns) walk(p, visit);
  if (node.repository) {
    for (const key of Object.keys(node.repository))
      walk(node.repository[key], visit);
  }
}

const KEYWORD_SCOPE =
  /^(keyword|storage\.type|storage\.modifier|constant\.language|variable\.language|support\.type\.primitive)/;

function fromTmLanguage(grammar: TmGrammar): ImportedGrammar {
  const keywords = new Set<string>();
  const strings = new Set<string>();
  let lineComment = "";
  let blockStart = "";
  let blockEnd = "";

  walk(grammar, (n) => {
    const scope = n.name ?? "";
    if (KEYWORD_SCOPE.test(scope) && n.match) {
      for (const kw of extractKeywords(n.match)) keywords.add(kw);
    }
    if (/^comment\.line/.test(scope)) {
      const lit = n.begin
        ? unescapeRe(n.begin)
        : n.match
          ? literalPrefix(n.match)
          : "";
      if (lit && !lineComment) lineComment = lit;
    } else if (/^comment/.test(scope) && n.begin && n.end) {
      if (!blockStart) {
        blockStart = unescapeRe(n.begin);
        blockEnd = unescapeRe(n.end);
      }
    }
    if (/^string/.test(scope) && n.begin) {
      const lit = unescapeRe(n.begin);
      if (lit.length === 1 && /["'`]/.test(lit)) strings.add(lit);
    }
  });

  const out: ImportedGrammar = {};
  if (keywords.size) out.keywords = [...keywords].join(" ");
  if (lineComment) out.lineComment = lineComment;
  if (blockStart && blockEnd) {
    out.blockCommentStart = blockStart;
    out.blockCommentEnd = blockEnd;
  }
  if (strings.size) out.stringDelimiters = [...strings].join("");
  return out;
}

function pairChar(p: Pair, end: boolean): string | undefined {
  if (Array.isArray(p)) return end ? p[1] : p[0];
  return end ? p.close : p.open;
}

function fromLanguageConfiguration(cfg: LangConfig): ImportedGrammar {
  const out: ImportedGrammar = {};
  const c = cfg.comments;
  if (c?.lineComment) out.lineComment = c.lineComment;
  if (Array.isArray(c?.blockComment) && c.blockComment.length === 2) {
    out.blockCommentStart = c.blockComment[0];
    out.blockCommentEnd = c.blockComment[1];
  }
  const quotes = new Set<string>();
  for (const p of [
    ...(cfg.surroundingPairs ?? []),
    ...(cfg.autoClosingPairs ?? []),
  ]) {
    const open = pairChar(p, false);
    const close = pairChar(p, true);
    if (open && open === close && /^["'`]$/.test(open)) quotes.add(open);
  }
  if (quotes.size) out.stringDelimiters = [...quotes].join("");
  return out;
}

/** Detect the file kind and extract what we can. Returns null on parse failure
 *  or when nothing useful was found. */
export function importGrammar(json: string): ImportResult | null {
  let cfg: unknown;
  try {
    cfg = parseJsonc(json);
  } catch {
    return null;
  }
  if (!cfg || typeof cfg !== "object") return null;
  const obj = cfg as TmGrammar & LangConfig;
  const isTm = Boolean(obj.patterns || obj.repository || obj.scopeName);
  const fields = isTm ? fromTmLanguage(obj) : fromLanguageConfiguration(obj);
  if (Object.keys(fields).length === 0) return null;
  return { kind: isTm ? "tmLanguage" : "languageConfiguration", fields };
}
