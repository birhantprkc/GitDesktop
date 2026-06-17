/**
 * Cold-start test mode — a faithful "brand-new user" simulation for walking the
 * onboarding flow without touching real data.
 *
 * Enabled by Vite env flags set by `scripts/cold-start.ps1`. Inert (every flag
 * false) in normal `pnpm tauri dev` and in production builds, where the
 * `VITE_COLD_START*` vars are undefined and statically replaced.
 *
 * When active it isolates every piece of personal state to a throwaway
 * namespace, so the real install is never read or written:
 *   - Tauri stores (settings, local PRs, branch rules, automations) →
 *     separate `coldstart-*.json` files in the same app-data dir.
 *   - API keys → an isolated `sessionStorage` store instead of the OS keychain
 *     (the Rust keychain commands reject unknown provider ids anyway), so real
 *     keys are never read and test keys vanish when the window closes.
 *   - Optionally forces git / gh "missing" so the GitMissingScreen and
 *     gh-not-connected states can be exercised without uninstalling anything.
 */

// import.meta.env only types the built-in keys; read our custom flags loosely.
const env = import.meta.env as Record<string, string | undefined>;

export const COLD_START = env.VITE_COLD_START === "1";
export const COLD_START_NO_GIT =
  COLD_START && env.VITE_COLD_START_NO_GIT === "1";
export const COLD_START_NO_GH = COLD_START && env.VITE_COLD_START_NO_GH === "1";

/** Tauri store filename, redirected to a throwaway file under cold start. */
export function storeName(name: string): string {
  return COLD_START ? `coldstart-${name}` : name;
}

// Cold-start API keys live in sessionStorage, never the OS keychain — fresh
// each launch, isolated from the user's real provider keys.
const COLD_SECRET_PREFIX = "coldstart-secret:";

export function coldStartGetSecret(provider: string): string | null {
  return sessionStorage.getItem(COLD_SECRET_PREFIX + provider);
}

export function coldStartSetSecret(provider: string, value: string): void {
  sessionStorage.setItem(COLD_SECRET_PREFIX + provider, value);
}

export function coldStartDeleteSecret(provider: string): void {
  sessionStorage.removeItem(COLD_SECRET_PREFIX + provider);
}
