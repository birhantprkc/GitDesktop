import {
  type DiffAST,
  type DiffFileHighlighter,
  processAST,
} from "@git-diff-view/react";
import { createHighlighterCoreSync, type HighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
// Bundled grammars for languages highlight.js can't render. Each default export
// is a flattened `LanguageRegistration[]` — the language plus every grammar it
// embeds — so loading it also wires up the embeds (e.g. astro/vue frontmatter =
// TS, <style> = CSS, expressions = TSX).
import astroGrammar from "@shikijs/langs/astro";
import gdscriptGrammar from "@shikijs/langs/gdscript";
import hclGrammar from "@shikijs/langs/hcl";
import jsonnetGrammar from "@shikijs/langs/jsonnet";
import jsxGrammar from "@shikijs/langs/jsx";
import prismaGrammar from "@shikijs/langs/prisma";
import solidityGrammar from "@shikijs/langs/solidity";
import svelteGrammar from "@shikijs/langs/svelte";
import terraformGrammar from "@shikijs/langs/terraform";
import tomlGrammar from "@shikijs/langs/toml";
import tsxGrammar from "@shikijs/langs/tsx";
import vueGrammar from "@shikijs/langs/vue";
import wgslGrammar from "@shikijs/langs/wgsl";
import zigGrammar from "@shikijs/langs/zig";
import type { LanguageRegistration } from "@shikijs/types";
import type { CustomLanguage } from "@/lib/settings/api";
import { gdDark, gdLight } from "./shiki-theme";

/**
 * A TextMate highlighter for the diff, backed by Shiki with the pure-JS regex
 * engine (no WASM). Used for custom languages that carry a real
 * `.tmLanguage.json` grammar and for built-in Shiki languages highlight.js
 * lacks, so they render exactly like VSCode — far beyond what the minimal
 * highlight.js grammar can express. Everything is synchronous so it fits
 * @git-diff-view's sync `getAST`.
 */

let core: HighlighterCore | null = null;
const loaded = new Set<string>();

function getCore(): HighlighterCore {
  if (!core) {
    core = createHighlighterCoreSync({
      themes: [gdDark, gdLight],
      langs: [],
      // forgiving: skip Oniguruma patterns the JS engine can't convert rather
      // than throwing, so a quirky grammar still highlights the rest.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  }
  return core;
}

/** Register Shiki grammars for any custom languages that carry one. Idempotent. */
export function ensureShikiGrammars(langs: readonly CustomLanguage[]): void {
  for (const lang of langs) {
    if (!lang.tmGrammar || !lang.id || loaded.has(lang.id)) continue;
    try {
      // tmGrammar is parsed-from-disk JSON (an imported `.tmLanguage.json`), so
      // it's only loosely typed; assert it to the grammar shape Shiki expects.
      const grammar: LanguageRegistration = {
        ...lang.tmGrammar,
        name: lang.id,
      } as LanguageRegistration;
      getCore().loadLanguageSync(grammar);
      loaded.add(lang.id);
    } catch {
      // unsupported grammar — leave it unloaded; the diff falls back to plain
    }
  }
}

/** Whether a language id has a Shiki grammar loaded and ready. */
export function isShikiLang(id: string): boolean {
  return loaded.has(id);
}

/**
 * Languages Shiki bundles that highlight.js lacks (or renders poorly), offered
 * as built-in picker options. Each value is the full grammar bundle from
 * `@shikijs/langs` — the language plus every grammar it embeds. The key matches
 * the bundle's own grammar name (Shiki's filename convention), which is what
 * gets registered and what we pass to `codeToTokensBase`.
 */
const BUILTIN_LANGS: Record<string, LanguageRegistration[]> = {
  astro: astroGrammar,
  gdscript: gdscriptGrammar,
  hcl: hclGrammar,
  jsonnet: jsonnetGrammar,
  // tsx/jsx render via Shiki because highlight.js's typescript/javascript
  // grammars don't tokenize JSX (the markup stayed plain).
  jsx: jsxGrammar,
  prisma: prismaGrammar,
  solidity: solidityGrammar,
  svelte: svelteGrammar,
  terraform: terraformGrammar,
  toml: tomlGrammar,
  tsx: tsxGrammar,
  vue: vueGrammar,
  wgsl: wgslGrammar,
  zig: zigGrammar,
};

/** Ids of the built-in Shiki languages, for pickers / language lists. */
export function builtinShikiLangs(): readonly string[] {
  return Object.keys(BUILTIN_LANGS);
}

/**
 * Load a built-in Shiki language (and its embedded grammars) on demand.
 * Returns true once it's loaded and ready, false for an unknown id. Idempotent.
 */
export function ensureBuiltinShikiLang(id: string): boolean {
  if (loaded.has(id)) return true;
  const bundle = BUILTIN_LANGS[id];
  if (!bundle) return false;
  try {
    // The bundle is an array of grammars (the language + its embeds);
    // loadLanguageSync accepts the array directly. Duplicate embeds across
    // languages just overwrite — harmless.
    getCore().loadLanguageSync(bundle);
    loaded.add(id);
    return true;
  } catch {
    return false;
  }
}

// Shiki FontStyle bitmask: Italic = 1, Bold = 2, Underline = 4.
function styleFor(color: string | undefined, fontStyle: number | undefined) {
  const parts: string[] = [];
  if (color) parts.push(`color:${color}`);
  if (fontStyle) {
    if (fontStyle & 1) parts.push("font-style:italic");
    if (fontStyle & 2) parts.push("font-weight:bold");
    if (fontStyle & 4) parts.push("text-decoration:underline");
  }
  return parts.join(";");
}

/**
 * The app's *rendered* theme, read from the `.dark` class main.tsx toggles on
 * `<html>`. We can't trust the `theme` arg @git-diff-view threads to `getAST`:
 * it comes from `DiffFile.theme`, which still defaults to `"light"` when
 * `createDiffFile` runs `initSyntax` — and the view's later dark re-sync uses
 * the *default* highlighter, not ours, so a stale light tokenization would
 * stick (light token colors on the dark diff background = unreadable).
 */
function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

// An empty tree for inputs we can't tokenize; the renderer treats it as "no
// highlighting" and falls back to plain text, same as a missing AST.
const EMPTY_AST: DiffAST = { type: "root", children: [] };

// Flat hast (the same shape highlight.js produces): token spans separated by
// "\n" text nodes. The renderer applies each span's `properties.style` directly.
function buildHast(raw: string, lang: string): DiffAST {
  const lines = getCore().codeToTokensBase(raw, {
    lang,
    theme: isDarkMode() ? "gd-diff-dark" : "gd-diff-light",
  });
  const children: DiffAST["children"] = [];
  lines.forEach((line, i) => {
    for (const token of line) {
      children.push({
        type: "element",
        tagName: "span",
        properties: { style: styleFor(token.color, token.fontStyle) },
        children: [{ type: "text", value: token.content }],
      });
    }
    if (i < lines.length - 1) children.push({ type: "text", value: "\n" });
  });
  return { type: "root", children };
}

/**
 * A @git-diff-view DiffFileHighlighter that tokenizes with Shiki and emits
 * style-based spans (the renderer applies `properties.style` directly). AST
 * post-processing is reused from the default highlighter's exported `processAST`.
 */
export function shikiDiffHighlighter(): DiffFileHighlighter {
  return {
    name: "shiki",
    type: "style",
    maxLineToIgnoreSyntax: 5000,
    setMaxLineToIgnoreSyntax: () => undefined,
    ignoreSyntaxHighlightList: [],
    setIgnoreSyntaxHighlightList: () => undefined,
    getAST: (raw, _fileName, lang) => {
      if (!lang || !loaded.has(lang)) return EMPTY_AST;
      try {
        return buildHast(raw, lang);
      } catch {
        return EMPTY_AST;
      }
    },
    processAST,
    hasRegisteredCurrentLang: (lang) => loaded.has(lang),
  };
}
