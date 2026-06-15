import type { BranchProtection, BranchRulesConfig } from "./types";

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * fnmatch-style glob → anchored RegExp, matching GitHub's branch patterns:
 * `*` spans within a path segment, `**` spans across `/`, `?` is one non-slash
 * char, and `{a,b,c}` is alternation of literals. Everything else is literal.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        const parts = glob
          .slice(i + 1, end)
          .split(",")
          .map(escapeLiteral);
        re += `(?:${parts.join("|")})`;
        i = end;
      }
    } else {
      re += escapeLiteral(c);
    }
  }
  return new RegExp(`^${re}$`);
}

/** Whether `name` matches `glob`. A malformed glob simply matches nothing. */
export function matchesGlob(glob: string, name: string): boolean {
  try {
    return globToRegExp(glob).test(name);
  } catch {
    return false;
  }
}

/** Protections whose pattern matches `branch`. */
export function protectionsFor(
  config: BranchRulesConfig,
  branch: string,
): BranchProtection[] {
  return config.protections.filter(
    (p) => p.pattern.trim() !== "" && matchesGlob(p.pattern.trim(), branch),
  );
}

/** Whether deleting `branch` is blocked by a protection. */
export function isDeletionBlocked(
  config: BranchRulesConfig,
  branch: string,
): boolean {
  return protectionsFor(config, branch).some((p) => p.blockDeletion);
}

/**
 * An error message if `name` violates the naming policy, otherwise null.
 * Empty names pass (the form's `required` validator owns that case).
 */
export function branchNameError(
  config: BranchRulesConfig,
  name: string,
): string | null {
  const { naming } = config;
  const pattern = naming.pattern.trim();
  if (!naming.enabled || pattern === "" || name === "") return null;
  if (matchesGlob(pattern, name)) return null;
  const hint = naming.hint.trim();
  return hint
    ? `Branch names must match "${pattern}" (e.g. ${hint})`
    : `Branch names must match "${pattern}"`;
}
