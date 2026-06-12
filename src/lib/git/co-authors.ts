import type { CommitAuthor } from "./types";

/** "Name <email>" — the form git expects in a Co-authored-by trailer. */
export function formatCoAuthor(author: CommitAuthor): string {
  return `${author.name} <${author.email}>`;
}

/**
 * Parses free-form co-author input: "Name <email>" or a bare email (the
 * local part becomes the name). Returns null when there's no usable email.
 */
export function parseCoAuthorInput(text: string): CommitAuthor | null {
  const trimmed = text.trim();
  const withName = trimmed.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (withName) return { name: withName[1].trim(), email: withName[2] };
  const bareEmail = trimmed.match(/^([^<>\s]+)@[^<>\s]+$/);
  if (bareEmail) return { name: bareEmail[1], email: trimmed };
  return null;
}

/**
 * The trailer paragraph for a commit message. Trailers must form the final
 * paragraph, so callers append this after the body with a blank line.
 */
export function coAuthorTrailers(coAuthors: CommitAuthor[]): string {
  return coAuthors
    .map((a) => `Co-authored-by: ${formatCoAuthor(a)}`)
    .join("\n");
}
