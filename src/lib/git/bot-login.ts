// GitHub bot-login detection, shared by the forge-user avatar and the
// commit-author avatar so both agree on what counts as a bot and how to name it.
//
// gh returns bot logins as `app/dependabot`; forge payloads and no-reply emails
// carry `dependabot[bot]`. Both normalize to the bare bot name `dependabot`,
// which the `gh_bot_avatar` command resolves to the real avatar (login-derived
// `<host>/<login>.png` doesn't exist for bot accounts).

// GitHub's username grammar: a leading alphanumeric then up to 38 more
// alphanumerics-or-hyphens (39 total). The check is a security gate — the bare
// name feeds a process arg Rust-side, so a leading `-`, a slash, or brackets
// must be rejected here too (defense in depth; Rust re-validates).
const GH_USERNAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/**
 * The bare bot name for a GitHub bot handle — `app/<name>` or `<name>[bot]` —
 * or `null` when `handle` isn't a valid bot login. A bare `<name>` (no `app/`
 * prefix and no `[bot]` suffix) is NOT treated as a bot: this must only match
 * handles that are unambiguously bots, so human logins keep their normal
 * login-derived avatar.
 */
export function botLoginName(handle: string): string | null {
  const trimmed = handle.trim();
  let name: string | null = null;
  if (trimmed.startsWith("app/")) {
    // gh's bot shape; may also carry a `[bot]` suffix.
    name = trimmed.slice("app/".length).replace(/\[bot\]$/, "");
  } else if (trimmed.endsWith("[bot]")) {
    name = trimmed.slice(0, -"[bot]".length);
  }
  if (name && GH_USERNAME.test(name)) return name;
  return null;
}

/** Human-facing form of a login: GitHub bot handles (`app/<name>`, `<name>[bot]`)
 *  render as `<name>[bot]` (GitHub's own display form); anything else passes
 *  through unchanged. */
export function displayLogin(handle: string): string {
  const name = botLoginName(handle);
  return name ? `${name}[bot]` : handle;
}
