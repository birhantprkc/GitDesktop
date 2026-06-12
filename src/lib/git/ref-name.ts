/**
 * GitHub Desktop-style ref-name handling: instead of rejecting names with
 * spaces, sanitize them (spaces → dashes) and tell the user what will be
 * created.
 */
export function sanitizeRefName(raw: string): string {
  return raw.trim().replace(/\s+/g, "-");
}

/** Warning line for ref-name fields; null when the name is used as typed. */
export function refNameWarning(value: string): string | null {
  const sanitized = sanitizeRefName(value);
  if (!sanitized || sanitized === value.trim()) return null;
  return `Will be created as ${sanitized}`;
}
