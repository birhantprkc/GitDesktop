import { readRepoSyntax, writeRepoSyntax } from "@/lib/git/api";
import type { CustomLanguage } from "@/lib/settings/api";

/** Syntax config — extension→language map plus the custom grammars it can
 *  reference. The shape of the committed `.gitdesktop/syntax.json` file. */
export interface SyntaxConfig {
  syntaxMap: Record<string, string>;
  customLanguages: CustomLanguage[];
}

export const EMPTY_SYNTAX: SyntaxConfig = {
  syntaxMap: {},
  customLanguages: [],
};

/** Read the repo's shared config from `.gitdesktop/syntax.json`. */
export async function loadSharedSyntax(repo: string): Promise<SyntaxConfig> {
  const raw = await readRepoSyntax(repo);
  if (!raw) return EMPTY_SYNTAX;
  try {
    const parsed = JSON.parse(raw) as Partial<SyntaxConfig>;
    return {
      syntaxMap: parsed.syntaxMap ?? {},
      customLanguages: parsed.customLanguages ?? [],
    };
  } catch {
    return EMPTY_SYNTAX;
  }
}

/** Write the repo's shared config (pretty-printed, so the commit is readable). */
export async function saveSharedSyntax(
  repo: string,
  config: SyntaxConfig,
): Promise<void> {
  const json = JSON.stringify(
    { syntaxMap: config.syntaxMap, customLanguages: config.customLanguages },
    null,
    2,
  );
  await writeRepoSyntax(repo, `${json}\n`);
}

/**
 * Personal (global) config layered over shared (repo) config: a repo's
 * committed file provides team defaults; a user's own settings win on conflict.
 */
export function mergeSyntax(
  shared: SyntaxConfig,
  personal: SyntaxConfig,
): SyntaxConfig {
  const byId = new Map<string, CustomLanguage>();
  for (const lang of shared.customLanguages) byId.set(lang.id, lang);
  for (const lang of personal.customLanguages) byId.set(lang.id, lang);
  return {
    syntaxMap: { ...shared.syntaxMap, ...personal.syntaxMap },
    customLanguages: [...byId.values()],
  };
}
