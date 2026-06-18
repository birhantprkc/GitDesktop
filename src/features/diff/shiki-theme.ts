import type { ThemeRegistration } from "@shikijs/types";

/**
 * Bright, high-contrast token themes tuned to stay readable on the diff's
 * add/del line backgrounds (GitHub's `#18271f` / `#23191c`), where stock editor
 * themes wash out. Coverage is deliberately broad — including bare `variable`,
 * `support.class`, `keyword.other` — so even loosely-scoped grammars (a custom
 * DSL, a hand-rolled .tmLanguage) get colored instead of falling to a dim
 * default. Colors are the GitHub syntax palette, which is designed for exactly
 * these diff backgrounds.
 */

const dark = {
  fg: "#e6edf3",
  comment: "#8b949e",
  keyword: "#ff7b72",
  string: "#a5d6ff",
  number: "#79c0ff",
  variable: "#ffa657",
  func: "#d2a8ff",
  type: "#7ee787",
  tag: "#7ee787",
  attr: "#79c0ff",
};

const light = {
  fg: "#1f2328",
  comment: "#6e7781",
  keyword: "#cf222e",
  string: "#0a3069",
  number: "#0550ae",
  variable: "#953800",
  func: "#8250df",
  type: "#116329",
  tag: "#116329",
  attr: "#0550ae",
};

function build(name: string, type: "dark" | "light", c: typeof dark) {
  return {
    name,
    type,
    colors: { "editor.foreground": c.fg },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c.comment, fontStyle: "italic" },
      },
      {
        scope: ["string", "string.quoted", "string.regexp", "string.template"],
        settings: { foreground: c.string },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.character",
          "constant.character.escape",
          "constant.other",
        ],
        settings: { foreground: c.number },
      },
      {
        scope: [
          "keyword",
          "keyword.control",
          "keyword.operator",
          "keyword.other",
          "storage",
          "storage.type",
          "storage.modifier",
          "support.class",
          "support.type.primitive",
        ],
        settings: { foreground: c.keyword },
      },
      {
        scope: [
          "variable",
          "variable.other",
          "variable.parameter",
          "variable.language",
          "meta.definition.variable",
          "entity.name.variable",
        ],
        settings: { foreground: c.variable },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "meta.function-call.generic",
        ],
        settings: { foreground: c.func },
      },
      {
        scope: ["entity.name.type", "entity.name.class", "support.type"],
        settings: { foreground: c.type },
      },
      {
        scope: ["entity.name.tag", "punctuation.definition.tag"],
        settings: { foreground: c.tag },
      },
      {
        scope: ["entity.other.attribute-name"],
        settings: { foreground: c.attr },
      },
    ],
  } satisfies ThemeRegistration;
}

export const gdDark = build("gd-diff-dark", "dark", dark);
export const gdLight = build("gd-diff-light", "light", light);
